/**
 * Task 03B dispatch coordination on the Host side.
 *
 * The Host never calls a Remote method. It:
 * - re-validates Todo / Workspace / Session from fresh public Host state;
 * - persists the immutable execution intent before the Client creates/forks;
 * - stores the actual target Session id before any prompt is sent;
 * - independently verifies prompt acceptance from the stored Session log
 *   (read-only `sessionPersistence.open`), instead of trusting the Client;
 * - turns ambiguous outcomes into `unknown` instead of retrying non-idempotent
 *   session creation/forking.
 */
import {
  detectSessionBlankState,
  type LiveSessionsLike,
  type PersistedSessionLike,
  type SessionPersistenceLike,
  type SessionTitleLike,
  type WorkspaceEntityLike,
  type WorkspaceRegistryLike,
} from './execution-context.js'
import {
  TodoStorageDefiniteError,
  TodoStorageUncertainError,
} from './store.js'
import type { ExecutionStore } from './execution-store.js'
import type {
  ExecutionRecord,
  ExecutionStatus,
  ExecutionStrategy,
} from './execution-model.js'
import type { Todo } from './model.js'

export interface ExecutionClock {
  isoNow(): string
  epochMs(): number
}

export interface ExecutionIdFactory {
  executionId(): string
  requestId(): string
}

export interface ExecutionServiceOptions {
  store: ExecutionStore
  todoLookup: (id: string) => Todo | undefined
  workspaceRegistry?: WorkspaceRegistryLike
  sessionPersistence?: SessionPersistenceLike
  sessions?: LiveSessionsLike
  sessionTitle?: SessionTitleLike
  clock: ExecutionClock
  ids: ExecutionIdFactory
}

export type ExecutionServiceErrorCode =
  | 'execution_unavailable'
  | 'invalid_payload'
  | 'execution_not_found'
  | 'execution_conflict'
  | 'invalid_transition'
  | 'todo_not_found'
  | 'workspace_not_found'
  | 'workspace_unavailable'
  | 'source_session_required'
  | 'source_session_not_found'
  | 'source_session_wrong_workspace'
  | 'source_session_blank'
  | 'source_session_state_unknown'
  | 'target_session_not_found'
  | 'target_session_wrong_workspace'
  | 'target_session_not_blank'
  | 'target_session_already_bound'
  | 'candidate_not_found'
  | 'verification_unavailable'
  | 'storage_failed'
  | 'storage_uncertain'

export class ExecutionServiceError extends Error {
  readonly code: ExecutionServiceErrorCode

  constructor(code: ExecutionServiceErrorCode, message: string) {
    super(message)
    this.name = 'ExecutionServiceError'
    this.code = code
  }
}

export interface CreateExecutionIntentInput {
  clientRequestId?: unknown
  todoId?: unknown
  strategy?: unknown
  workspaceId?: unknown
  sourceSessionId?: unknown
}

export interface PromptResultReport {
  outcome: 'accepted' | 'failed' | 'unknown'
  errorCode?: string
}

export interface UnknownCandidate {
  sessionId: string
  createdAt?: number
  blankState: 'blank' | 'non-blank' | 'unknown'
  title?: string
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function classifyTargetStrategy(strategy: ExecutionStrategy): void {
  if (strategy !== 'new' && strategy !== 'reuse' && strategy !== 'fork') {
    throw new ExecutionServiceError('invalid_payload', 'Unknown execution strategy.')
  }
}

export class ExecutionService {
  private readonly options: ExecutionServiceOptions

  constructor(options: ExecutionServiceOptions) {
    this.options = options
  }

  async createIntent(input: CreateExecutionIntentInput): Promise<ExecutionRecord> {
    const clientRequestId = readString(input.clientRequestId)
    const todoId = readString(input.todoId)
    const workspaceId = readString(input.workspaceId)
    const sourceSessionId = readOptionalString(input.sourceSessionId)
    const strategy = input.strategy
    classifyTargetStrategy(strategy as ExecutionStrategy)
    if (clientRequestId === undefined || todoId === undefined || workspaceId === undefined) {
      throw new ExecutionServiceError('invalid_payload', 'clientRequestId, todoId and workspaceId are required.')
    }
    const typedStrategy = strategy as ExecutionStrategy

    // Idempotency is keyed by the Client-generated intent id and takes
    // precedence over re-validation, so a retried HTTP call returns the
    // original record instead of creating a second execution.
    const existing = this.findByClientRequestId(clientRequestId)
    if (existing !== undefined) {
      if (existing.todoId !== todoId || existing.strategy !== typedStrategy || existing.workspaceId !== workspaceId) {
        throw new ExecutionServiceError('execution_conflict', 'This intent id was already used with different dispatch parameters.')
      }
      return existing
    }

    const todo = this.options.todoLookup(todoId)
    if (todo === undefined) throw new ExecutionServiceError('todo_not_found', 'The Todo no longer exists.')
    const workspace = await this.requireWorkspace(workspaceId)
    if (typedStrategy === 'new') {
      if (sourceSessionId !== undefined) {
        throw new ExecutionServiceError('invalid_payload', 'The new-session strategy must not name a source Session.')
      }
    } else {
      if (sourceSessionId === undefined) {
        throw new ExecutionServiceError('source_session_required', 'Select a source Session.')
      }
      await this.requireSourceSession(workspace, sourceSessionId)
    }

    const now = this.options.clock.isoNow()
    const record: ExecutionRecord = {
      executionId: this.options.ids.executionId(),
      clientRequestId,
      requestId: this.options.ids.requestId(),
      todoId,
      todoTitle: todo.title,
      promptText: buildPromptSnapshot(todo),
      strategy: typedStrategy,
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      ...(sourceSessionId === undefined ? {} : { sourceSessionId }),
      status: 'prepared',
      createdAt: now,
      updatedAt: now,
      createdAtMs: this.options.clock.epochMs(),
    }

    return this.durable(() => this.options.store.mutate((current) => {
      const duplicate = current.find((entry) => entry.clientRequestId === clientRequestId)
      if (duplicate !== undefined) {
        return { next: current, result: duplicate }
      }
      return { next: [...current, record], result: record }
    }))
  }

  async markSessionReady(executionId: string, sessionId: string): Promise<ExecutionRecord> {
    const existing = this.requireRecord(executionId)
    if (existing.targetSessionId === sessionId && existing.status !== 'prepared') return existing
    if (existing.status !== 'prepared' && existing.status !== 'dispatching' && existing.status !== 'unknown') {
      throw new ExecutionServiceError('invalid_transition', 'Only a prepared/dispatching/unknown execution can record a target Session.')
    }

    const workspace = await this.requireWorkspace(existing.workspaceId)
    const snapshot = await this.requireSessionSnapshot(sessionId)
    this.assertWorkspaceMember(workspace, snapshot, 'target_session_wrong_workspace')
    if (existing.strategy === 'new') {
      const blankState = await this.blankStateOf(snapshot)
      if (blankState !== 'blank') {
        throw new ExecutionServiceError('target_session_not_blank', 'The new Session must still be blank before its first prompt.')
      }
    } else if (existing.strategy === 'reuse') {
      if (existing.sourceSessionId !== sessionId) {
        throw new ExecutionServiceError('target_session_wrong_workspace', 'Reuse must dispatch into the selected source Session.')
      }
    }
    if (existing.strategy === 'fork') {
      if (existing.sourceSessionId === sessionId) {
        throw new ExecutionServiceError('target_session_already_bound', 'A fork target must be the new child Session.')
      }
    }

    return this.updateRecord(existing.executionId, (current) => ({
      ...current,
      targetSessionId: sessionId,
      status: 'session_ready',
      errorCode: undefined,
    }))
  }

  /**
   * Mark the execution as dispatching before the Client performs the
   * non-idempotent create/fork. This makes a retried intent (same
   * clientRequestId) return a non-prepared record instead of allowing the
   * Client to create a second Session.
   */
  async beginDispatching(executionId: string): Promise<ExecutionRecord> {
    const existing = this.requireRecord(executionId)
    if (existing.status === 'dispatching' || existing.status === 'accepted') return existing
    if (existing.status !== 'prepared' && existing.status !== 'session_ready') {
      throw new ExecutionServiceError('invalid_transition', 'Only prepared or session_ready executions can start dispatching.')
    }
    return this.updateRecord(executionId, (current) => ({ ...current, status: 'dispatching' }))
  }

  async reportPromptResult(
    executionId: string,
    report: PromptResultReport,
  ): Promise<ExecutionRecord> {
    const existing = this.requireRecord(executionId)
    if (existing.status === 'accepted') return existing
    if (report.outcome !== 'accepted' && report.outcome !== 'failed' && report.outcome !== 'unknown') {
      throw new ExecutionServiceError('invalid_payload', 'Unknown prompt result outcome.')
    }

    const verified = await this.verifyPromptAccepted(existing)
    let status: ExecutionStatus
    if (verified === 'accepted') status = 'accepted'
    else if (report.outcome === 'accepted') status = 'dispatching'
    else if (report.outcome === 'failed') status = 'failed'
    else status = 'unknown'

    return this.updateRecord(executionId, (current) => ({
      ...current,
      status,
      errorCode: status === 'accepted' ? undefined : report.errorCode,
    }))
  }

  async markUnknown(executionId: string, errorCode?: string): Promise<ExecutionRecord> {
    const existing = this.requireRecord(executionId)
    if (existing.status === 'accepted') return existing
    return this.updateRecord(executionId, (current) => ({
      ...current,
      status: 'unknown',
      errorCode,
    }))
  }

  async markFailed(executionId: string, errorCode?: string): Promise<ExecutionRecord> {
    const existing = this.requireRecord(executionId)
    if (existing.status === 'accepted') return existing
    return this.updateRecord(executionId, (current) => ({
      ...current,
      status: 'failed',
      errorCode,
    }))
  }

  /** Read status, opportunistically verifying a pending prompt from the log. */
  async getStatus(executionId: string): Promise<ExecutionRecord> {
    const existing = this.requireRecord(executionId)
    if (existing.status !== 'dispatching') return existing
    if (existing.targetSessionId === undefined) {
      // Interrupted during create/fork. Never let the Client re-create/fork
      // automatically; surface it as unknown with the candidate UI.
      return this.updateRecord(executionId, (current) => ({
        ...current,
        status: 'unknown',
        errorCode: 'dispatch_interrupted',
      }))
    }
    const verified = await this.verifyPromptAccepted(existing)
    if (verified !== 'accepted') return existing
    return this.updateRecord(executionId, (current) => ({ ...current, status: 'accepted', errorCode: undefined }))
  }

  listForTodo(todoId: string): ExecutionRecord[] {
    return this.options.store
      .read()
      .filter((record) => record.todoId === todoId)
      .sort((left, right) => right.createdAtMs - left.createdAtMs)
  }

  /** Sessions created after an unknown create/fork result, for manual binding. */
  async candidates(executionId: string): Promise<UnknownCandidate[]> {
    const record = this.requireRecord(executionId)
    if (record.status !== 'unknown') {
      throw new ExecutionServiceError('invalid_transition', 'Candidates are only listed for unknown outcomes.')
    }
    const persistence = this.options.sessionPersistence
    if (persistence === undefined) {
      throw new ExecutionServiceError('execution_unavailable', 'Session persistence is unavailable.')
    }
    const snapshots = await persistence.list()
    const bound = new Set(
      this.options.store
        .read()
        .filter((entry) => entry.executionId !== record.executionId && entry.targetSessionId !== undefined)
        .map((entry) => entry.targetSessionId as string),
    )
    const candidates: UnknownCandidate[] = []
    for (const snapshot of snapshots) {
      const sessionId = String(snapshot.header.id)
      if (sessionId === record.sourceSessionId) continue
      if (bound.has(sessionId)) continue
      if (snapshot.header.origin === 'subagent') continue
      if (snapshot.header.cwd !== record.workspacePath) continue
      if (typeof snapshot.header.createdAt === 'number' && snapshot.header.createdAt < record.createdAtMs) continue
      candidates.push({
        sessionId,
        createdAt: snapshot.header.createdAt,
        blankState: await this.blankStateOf(snapshot),
        title: this.liveTitle(sessionId),
      })
    }
    candidates.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
    return candidates
  }

  /** Explicit user selection of a candidate for an unknown execution. */
  async bindCandidate(executionId: string, sessionId: string): Promise<ExecutionRecord> {
    const record = this.requireRecord(executionId)
    if (record.status !== 'unknown' && record.status !== 'prepared') {
      throw new ExecutionServiceError('invalid_transition', 'Only an unknown/prepared execution can be bound manually.')
    }
    const persistence = this.options.sessionPersistence
    if (persistence === undefined) {
      throw new ExecutionServiceError('execution_unavailable', 'Session persistence is unavailable.')
    }
    const workspace = await this.requireWorkspace(record.workspaceId)
    const snapshot = await this.requireSessionSnapshot(sessionId)
    this.assertWorkspaceMember(workspace, snapshot, 'target_session_wrong_workspace')
    if (snapshot.header.origin === 'subagent') {
      throw new ExecutionServiceError('candidate_not_found', 'Subagent Sessions cannot be selected.')
    }
    if (typeof snapshot.header.createdAt === 'number' && snapshot.header.createdAt < record.createdAtMs) {
      throw new ExecutionServiceError('candidate_not_found', 'This Session predates the execution intent.')
    }
    const bound = this.options.store
      .read()
      .some((entry) => entry.executionId !== record.executionId && entry.targetSessionId === sessionId)
    if (bound) throw new ExecutionServiceError('target_session_already_bound', 'This Session is already bound to another execution.')

    return this.updateRecord(executionId, (current) => ({
      ...current,
      targetSessionId: sessionId,
      status: 'session_ready',
      errorCode: undefined,
    }))
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private requireRecord(executionId: string): ExecutionRecord {
    const record = this.options.store.read().find((entry) => entry.executionId === executionId)
    if (record === undefined) throw new ExecutionServiceError('execution_not_found', 'Execution was not found.')
    return record
  }

  private findByClientRequestId(clientRequestId: string): ExecutionRecord | undefined {
    return this.options.store.read().find((entry) => entry.clientRequestId === clientRequestId)
  }

  private updateRecord(
    executionId: string,
    update: (current: ExecutionRecord) => ExecutionRecord,
  ): Promise<ExecutionRecord> {
    return this.durable(() => this.options.store.mutate((current) => {
      const index = current.findIndex((entry) => entry.executionId === executionId)
      if (index === -1) throw new ExecutionServiceError('execution_not_found', 'Execution was not found.')
      const updated = { ...update(current[index]), updatedAt: this.options.clock.isoNow() }
      const next = current.slice()
      next[index] = updated
      return { next, result: updated }
    }))
  }

  private async requireWorkspace(workspaceId: string): Promise<WorkspaceEntityLike> {
    const registry = this.options.workspaceRegistry
    if (registry === undefined) {
      throw new ExecutionServiceError('execution_unavailable', 'The workspace registry is unavailable.')
    }
    const workspace = registry.get?.(workspaceId) ?? registry.list().find((entry) => entry.id === workspaceId)
    if (workspace === undefined) {
      throw new ExecutionServiceError('workspace_not_found', 'The selected Workspace no longer exists.')
    }
    let status: 'ok' | 'missing-dir'
    try {
      status = await workspace.status()
    } catch {
      throw new ExecutionServiceError('workspace_unavailable', 'The selected Workspace could not be checked.')
    }
    if (status !== 'ok') {
      throw new ExecutionServiceError('workspace_unavailable', 'The selected Workspace directory is unavailable.')
    }
    return workspace
  }

  private async requireSourceSession(
    workspace: WorkspaceEntityLike,
    sourceSessionId: string,
  ): Promise<PersistedSessionLike> {
    const snapshot = await this.requireSessionSnapshot(sourceSessionId)
    this.assertWorkspaceMember(workspace, snapshot, 'source_session_wrong_workspace')
    const blankState = await this.blankStateOf(snapshot)
    if (blankState === 'blank') {
      throw new ExecutionServiceError('source_session_blank', 'The selected Session is blank; use the new-session strategy.')
    }
    if (blankState === 'unknown') {
      throw new ExecutionServiceError(
        'source_session_state_unknown',
        'The selected Session state could not be confirmed; it is not offered (conservative).',
      )
    }
    return snapshot
  }

  private async requireSessionSnapshot(sessionId: string): Promise<PersistedSessionLike> {
    const persistence = this.options.sessionPersistence
    if (persistence === undefined) {
      throw new ExecutionServiceError('execution_unavailable', 'Session persistence is unavailable.')
    }
    let snapshots: readonly PersistedSessionLike[]
    try {
      snapshots = await persistence.list()
    } catch (error) {
      throw new ExecutionServiceError('execution_unavailable', `Session list unavailable: ${describe(error)}`)
    }
    const snapshot = snapshots.find((entry) => String(entry.header.id) === sessionId)
    if (snapshot === undefined) {
      throw new ExecutionServiceError('target_session_not_found', 'The Session was not found.')
    }
    return snapshot
  }

  private assertWorkspaceMember(
    workspace: WorkspaceEntityLike,
    snapshot: PersistedSessionLike,
    code: 'source_session_wrong_workspace' | 'target_session_wrong_workspace',
  ): void {
    const member = workspace.sessionIds.map(String).includes(String(snapshot.header.id))
    const samePath = snapshot.header.cwd === workspace.path
    if (member || samePath) return
    throw new ExecutionServiceError(
      code,
      code === 'source_session_wrong_workspace'
        ? 'The selected Session does not belong to the Workspace.'
        : 'The target Session does not belong to the Workspace.',
    )
  }

  private async blankStateOf(snapshot: PersistedSessionLike): Promise<'blank' | 'non-blank' | 'unknown'> {
    const persistence = this.options.sessionPersistence
    if (persistence === undefined) return 'unknown'
    return detectSessionBlankState(snapshot, persistence)
  }

  private liveTitle(sessionId: string): string | undefined {
    const live = this.options.sessions?.get(sessionId)
    if (live === undefined) return undefined
    try {
      return this.options.sessionTitle?.get(live)?.title?.trim() || undefined
    } catch {
      return undefined
    }
  }

  /**
   * Independently verify prompt acceptance from the stored Session log: the
   * Host echoes the Remote prompt `requestId` as the durable user message
   * source's `rpcId`.
   */
  private async verifyPromptAccepted(
    record: ExecutionRecord,
  ): Promise<'accepted' | 'not-found' | 'unknown'> {
    const sessionId = record.targetSessionId
    const persistence = this.options.sessionPersistence
    if (sessionId === undefined || persistence?.open === undefined) return 'unknown'

    let handle
    try {
      handle = await persistence.open(sessionId, 'read')
    } catch {
      return 'unknown'
    }
    try {
      const pageSize = 200
      const limit = 20_000
      let offset = 0
      let scanned = 0
      while (scanned < limit) {
        const page = await handle.read(offset, pageSize)
        const events = page.events
        if (events.length === 0) return 'not-found'
        for (const event of events) {
          if (event.type !== 'user/message') continue
          const data = event.data as
            | { source?: { rpcId?: unknown } }
            | undefined
          if (typeof data?.source?.rpcId === 'string' && data.source.rpcId === record.requestId) {
            return 'accepted'
          }
        }
        scanned += events.length
        offset += events.length
        if (events.length < pageSize) return 'not-found'
      }
      return 'unknown'
    } catch {
      return 'unknown'
    } finally {
      try {
        await handle.close()
      } catch {
        // Closing a read handle cannot change the verification result.
      }
    }
  }

  private async durable<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof ExecutionServiceError) throw error
      if (error instanceof TodoStorageUncertainError) {
        throw new ExecutionServiceError(
          'storage_uncertain',
          'The execution record result is unknown. Reload or restart DSH before retrying.',
        )
      }
      if (error instanceof TodoStorageDefiniteError) {
        throw new ExecutionServiceError('storage_failed', 'The execution record was not saved.')
      }
      throw new ExecutionServiceError('storage_failed', `Execution record storage failed: ${describe(error)}`)
    }
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 128 ? value : undefined
}

function readOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return typeof value === 'string' && value.length <= 128 ? value : undefined
}

/** Immutable prompt snapshot: title plus optional description. */
export function buildPromptSnapshot(todo: Pick<Todo, 'title' | 'description'>): string {
  return todo.description === '' ? todo.title : `${todo.title}\n\n${todo.description}`
}
