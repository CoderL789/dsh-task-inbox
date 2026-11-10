/**
 * Storage-domain adapters with durable-outcome handling.
 *
 * Atomicity: v2 stores the complete ordered todo list in the domain global
 * value, so one `global.set()` publishes one complete file atomically.
 *
 * Durable-outcome safety (Task 02 review round 2): the JSON backend's `single`
 * layout publishes with temp-write → fsync → rename → directory-fsync. A
 * rejection can happen BEFORE the rename (nothing published, memory rolled
 * back) or AFTER it (file replaced, but fsync/rename error surfaced). The
 * Domain layer only rolls its memory back and does not mark the unit unusable
 * for such raw I/O errors, so continuing on that memory could overwrite newer
 * durable data. Therefore:
 *
 * - known pre-commit rejections are reported as definite failures;
 * - any ambiguous outcome closes the domain and reopens it, which reloads the
 *   authoritative disk state, then compares it with the attempted state:
 *   committed → success, previous state → definite failure, anything else or a
 *   failed reopen → the repository is poisoned and every later read/write
 *   reports "storage outcome uncertain" until the plugin is reloaded.
 *
 * A failed one-time v1→v2 migration write aborts plugin activation rather than
 * serving an empty list.
 */
import { sortTodos, type Todo } from './model.js'
import type { TodoGlobalState } from './domain.js'

/** The subset of the DSH `Domain.global` handle used here. */
export interface TodoGlobalHandleLike {
  get(): TodoGlobalState
  set(value: TodoGlobalState): Promise<void>
}

/** The subset of the legacy v1 `todos` table handle used here. */
export interface LegacyTodoTableLike {
  entries(): IterableIterator<[string, Todo]>
  deleteMany(keys: readonly string[]): Promise<number>
}

/** The subset of an opened DSH `Domain` (version 2) used here. */
export interface TodoDomainLike {
  global: TodoGlobalHandleLike
  table(name: 'todos'): LegacyTodoTableLike
  close(): Promise<void>
}

/** Whole-list persistence contract consumed by `TodoService`. */
export interface TodoStateRepository {
  read(): Todo[]
  write(todos: readonly Todo[]): Promise<void>
}

export class TodoStorageDefiniteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TodoStorageDefiniteError'
  }
}

export class TodoStorageUncertainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TodoStorageUncertainError'
  }
}

export type StorageFailureKind = 'definite' | 'indeterminate'

const DEFINITE_STORAGE_CODES = new Set([
  'closed',
  'invalid-record',
  'malformed-medium',
  'version-mismatch',
  'backend-not-found',
  'facet-unsupported',
])

function errorIdentity(error: unknown): { name: string; code: string } | null {
  if (typeof error !== 'object' || error === null) return null
  const record = error as { name?: unknown; code?: unknown }
  return {
    name: typeof record.name === 'string' ? record.name : '',
    code: typeof record.code === 'string' ? record.code : '',
  }
}

/**
 * Decide whether a rejected write is provably pre-commit (definite) or may
 * already be durable (indeterminate).
 *
 * - `DomainError` rejections happen at the domain seam before/without an
 *   ambiguous medium publish.
 * - `StorageError` `unknown-state` is the backend's explicit uncertainty signal.
 * - Other `StorageError` codes are pre-write contract violations.
 * - Raw filesystem errors from the JSON `single` layout are indeterminate:
 *   writeAtomic can reject after `rename()` succeeded but directory fsync failed.
 * - A TypeError means serialization failed before any file write.
 */
export function classifyStorageWriteError(error: unknown): StorageFailureKind {
  if (error instanceof TodoStorageUncertainError) return 'indeterminate'
  if (error instanceof TodoStorageDefiniteError) return 'definite'
  if (error instanceof TypeError) return 'definite'

  const identity = errorIdentity(error)
  if (identity !== null && identity.name === 'DomainError') return 'definite'
  if (identity !== null && identity.name === 'StorageError') {
    if (identity.code === 'unknown-state') return 'indeterminate'
    return DEFINITE_STORAGE_CODES.has(identity.code) ? 'definite' : 'indeterminate'
  }
  return 'indeterminate'
}

/** Structural comparison used to confirm an ambiguous write against disk. */
export function sameTodoList(left: readonly Todo[], right: readonly Todo[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (
      a.id !== b.id ||
      a.title !== b.title ||
      a.description !== b.description ||
      a.status !== b.status ||
      a.createdAt !== b.createdAt ||
      a.updatedAt !== b.updatedAt ||
      a.order !== b.order
    ) {
      return false
    }
  }
  return true
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class DomainTodoRepository implements TodoStateRepository {
  private domain: TodoDomainLike
  private readonly reopen: (() => Promise<TodoDomainLike>) | undefined
  private uncertain: TodoStorageUncertainError | null = null
  private closed = false

  constructor(domain: TodoDomainLike, reopen?: () => Promise<TodoDomainLike>) {
    this.domain = domain
    this.reopen = reopen
  }

  read(): Todo[] {
    this.assertUsable()
    try {
      return [...this.domain.global.get().todos]
    } catch (error) {
      throw this.readFailure(error)
    }
  }

  async write(todos: readonly Todo[]): Promise<void> {
    this.assertUsable()
    const next = [...todos]
    const previous = this.read()
    try {
      await this.domain.global.set({ todos: next, migrated: true })
      return
    } catch (error) {
      await this.handleWriteFailure(error, previous, next)
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.domain.close()
  }

  private assertUsable(): void {
    if (this.uncertain !== null) throw this.uncertain
    if (this.closed) {
      throw new TodoStorageDefiniteError('The task inbox storage is closed.')
    }
  }

  private readFailure(error: unknown): Error {
    if (error instanceof TodoStorageUncertainError) return error
    if (this.uncertain !== null) return this.uncertain
    return new TodoStorageDefiniteError(
      `The task inbox storage could not be read: ${describeError(error)}`,
    )
  }

  private async handleWriteFailure(
    error: unknown,
    previous: readonly Todo[],
    attempted: readonly Todo[],
  ): Promise<void> {
    if (classifyStorageWriteError(error) === 'definite') {
      throw new TodoStorageDefiniteError(`The change was not saved: ${describeError(error)}`)
    }

    // The write may already be durable. Stop using current memory, reload the
    // authoritative disk state, and only then decide the operation outcome.
    if (this.reopen === undefined) {
      throw this.poison(error)
    }

    let reopened: TodoDomainLike
    try {
      await this.domain.close()
      reopened = await this.reopen()
    } catch (recoveryError) {
      throw this.poison(error, recoveryError)
    }
    this.domain = reopened

    let durable: Todo[]
    try {
      durable = [...reopened.global.get().todos]
    } catch (readError) {
      throw this.poison(error, readError)
    }

    if (sameTodoList(durable, attempted)) {
      // The failed API call actually committed; memory now equals disk.
      return
    }
    if (sameTodoList(durable, previous)) {
      // Disk confirms the write was not applied.
      throw new TodoStorageDefiniteError('The change was not saved to storage.')
    }
    throw this.poison(error)
  }

  private poison(original: unknown, recoveryError?: unknown): TodoStorageUncertainError {
    const recoveryNote =
      recoveryError === undefined ? '' : `; reload also failed: ${describeError(recoveryError)}`
    const error = new TodoStorageUncertainError(
      `The storage result is unknown (${describeError(original)}${recoveryNote}). ` +
        'Reload or restart DSH to reload the durable data before trying again.',
    )
    this.uncertain = error
    return error
  }
}

export interface MigrationLogger {
  warn?(message: string): void
}

/**
 * Migrate v1 table rows into the v2 global list, exactly once.
 *
 * Throws when the migration write itself fails: continuing would serve an
 * empty list while the old data still exists in the table, which looks like
 * data loss. Cleanup failures are non-fatal and only logged.
 */
export async function migrateLegacyTodos(
  domain: TodoDomainLike,
  logger?: MigrationLogger,
): Promise<void> {
  let state = domain.global.get()

  if (!state.migrated) {
    const legacyRows = [...domain.table('todos').entries()]
    if (legacyRows.length === 0) {
      // Fresh install: keep the initial state; the first mutation writes the
      // migrated marker. No file is created merely by opening the plugin.
      return
    }

    const todos = sortTodos(legacyRows.map(([, todo]) => todo)).map((todo, index) => ({
      ...todo,
      order: index,
    }))
    await domain.global.set({ todos, migrated: true })
    state = domain.global.get()
  }

  if (!state.migrated) return

  const remaining = [...domain.table('todos').entries()]
  if (remaining.length === 0) return

  try {
    await domain.table('todos').deleteMany(remaining.map(([key]) => key))
  } catch (error) {
    logger?.warn?.(
      `task-inbox: legacy v1 todo rows could not be removed after migration; ` +
        `data is safe in the v2 global state: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
