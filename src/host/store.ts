/**
 * Storage-domain adapters.
 *
 * `DomainTodoRepository` exposes the v2 global state as a whole-list
 * read/write pair: one write replaces the complete ordered list atomically,
 * which is the basis of the all-or-nothing mutation guarantee.
 *
 * `migrateLegacyTodos` performs the one-time v1 → v2 conversion:
 * - Open with `version: 2` + `compatibleVersions: [1]` reads both the (empty)
 *   global value and the old `todos` table rows.
 * - Rows are sorted by their old order, renumbered, and written to the global
 *   value in ONE atomic write together with `migrated: true`.
 * - Legacy rows are then deleted in one `deleteMany` call (best effort: a
 *   failure is logged and leaves duplicate legacy rows, but the `migrated`
 *   marker prevents a second migration).
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

export class DomainTodoRepository implements TodoStateRepository {
  private readonly domain: TodoDomainLike

  constructor(domain: TodoDomainLike) {
    this.domain = domain
  }

  read(): Todo[] {
    // Shallow copy: callers may sort/filter but must not mutate stored records.
    return [...this.domain.global.get().todos]
  }

  write(todos: readonly Todo[]): Promise<void> {
    return this.domain.global.set({ todos: [...todos], migrated: true })
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
