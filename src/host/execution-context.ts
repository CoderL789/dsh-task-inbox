/**
 * Read-only execution-context discovery for Task 03A.
 *
 * The Task Inbox page must let the user choose a Workspace, a session strategy
 * (new / reuse / fork), and — for reuse/fork — a source session. This module
 * derives those candidates from Host APIs that are confirmed public in the
 * installed DSH (0.2.2-rc.1):
 *
 * - `ctx.workspaceRegistry.list()` — registered Workspaces, canonical path and
 *   the canonical-cwd-filtered `sessionIds` (public Host service).
 * - `ctx.sessionPersistence.list()` — stored Session headers plus optional
 *   event counts, without resuming an Agent (public Host service).
 * - `ctx.sessions.get(id)` — live Session instances (public Host store).
 * - `ctx.sessionTitle.get(session)` — display title for live Sessions (public
 *   Host service).
 *
 * It performs no Session creation, no Agent resume, no archive/pin mutation,
 * and never touches Workspace or Session state. Dispatch itself is Task 03B.
 *
 * Eligibility rules are intentionally conservative and preview-oriented:
 * - a session must be stored and belong to the selected Workspace;
 * - a blank session (no stored event) is not offered for reuse or fork —
 *   the "new session" strategy is the right choice there;
 * - archive state and completed-turn availability are not exposed by the
 *   public Host APIs used here, so they are surfaced as warnings and remain
 *   the dispatch-time Host's authority.
 */
export type ExecutionStrategy = 'new' | 'reuse' | 'fork'

export type SelectionErrorCode =
  | 'context_unavailable'
  | 'workspace_missing'
  | 'workspace_unavailable'
  | 'session_required'
  | 'session_not_found'
  | 'session_wrong_workspace'
  | 'session_unsuitable'

export type SelectionValidation =
  | { ok: true }
  | { ok: false; code: SelectionErrorCode; message: string }

export type WorkspaceAvailability = 'ok' | 'missing-dir' | 'unknown'

export interface ExecutionWorkspace {
  id: string
  title: string
  path: string
  available: boolean
  availability: WorkspaceAvailability
}

export interface ExecutionSession {
  sessionId: string
  workspaceId: string
  title?: string
  createdAt?: number
  live: boolean
  stored: boolean
  blank: boolean
  suitableForReuse: boolean
  suitableForFork: boolean
  /** Machine-readable reasons a strategy is unavailable. */
  unavailableReasons: string[]
  /** Informational caveats (archive state / fork turn validation). */
  warnings: string[]
}

export interface ExecutionContextSnapshot {
  available: boolean
  reason?: string
  workspaces: ExecutionWorkspace[]
  sessions: ExecutionSession[]
}

export interface ExecutionContextProvider {
  build(): Promise<ExecutionContextSnapshot>
}

// ---------------------------------------------------------------------------
// Raw descriptors (structural views of the Host services used above)
// ---------------------------------------------------------------------------

export interface RawWorkspace {
  id: string
  title: string
  path: string
  sessionIds: readonly string[]
  availability: WorkspaceAvailability
}

export interface RawSessionSnapshot {
  id: string
  cwd?: string
  createdAt?: number
  parentSessionId?: string
  origin?: string
  eventCount?: number
}

export interface AssembleExecutionContextInput {
  workspaces: readonly RawWorkspace[]
  snapshots: readonly RawSessionSnapshot[]
  liveSessionIds: readonly string[]
  titles: ReadonlyMap<string, string>
}

/** Build candidates from already-fetched descriptors (pure, unit-tested). */
export function assembleExecutionContext(
  input: AssembleExecutionContextInput,
): ExecutionContextSnapshot {
  const snapshotById = new Map<string, RawSessionSnapshot>()
  for (const snapshot of input.snapshots) snapshotById.set(snapshot.id, snapshot)
  const live = new Set(input.liveSessionIds)
  const seen = new Set<string>()

  const workspaces: ExecutionWorkspace[] = input.workspaces.map((workspace) => ({
    id: workspace.id,
    title: workspace.title,
    path: workspace.path,
    availability: workspace.availability,
    available: workspace.availability === 'ok',
  }))

  const sessions: ExecutionSession[] = []
  for (const workspace of input.workspaces) {
    for (const sessionId of workspace.sessionIds) {
      if (seen.has(sessionId)) continue
      seen.add(sessionId)
      const snapshot = snapshotById.get(sessionId)
      // Subagent-origin sessions are not ordinary conversation candidates.
      if (snapshot?.origin === 'subagent') continue

      const stored = snapshot !== undefined
      const blank = stored ? (snapshot?.eventCount ?? 0) === 0 : false
      const unavailableReasons: string[] = []
      const warnings: string[] = []

      if (!stored) unavailableReasons.push('session_not_found')
      else if (blank) unavailableReasons.push('blank_session')

      warnings.push('archive_state_unknown')
      warnings.push('fork_requires_completed_turn')

      sessions.push({
        sessionId,
        workspaceId: workspace.id,
        title: input.titles.get(sessionId),
        createdAt: snapshot?.createdAt,
        live: live.has(sessionId),
        stored,
        blank,
        suitableForReuse: stored && !blank,
        suitableForFork: stored && !blank,
        unavailableReasons,
        warnings,
      })
    }
  }

  return { available: true, workspaces, sessions }
}

/** Sessions belonging to one Workspace (the UI's association rule). */
export function filterSessionsForWorkspace(
  context: ExecutionContextSnapshot,
  workspaceId: string | undefined,
): ExecutionSession[] {
  if (workspaceId === undefined || workspaceId === '') return []
  return context.sessions.filter((session) => session.workspaceId === workspaceId)
}

/** True when a session can serve as the source for the given strategy. */
export function isSessionSuitable(
  session: ExecutionSession,
  strategy: ExecutionStrategy,
): boolean {
  if (strategy === 'reuse') return session.suitableForReuse
  if (strategy === 'fork') return session.suitableForFork
  return strategy === 'new'
}

/**
 * Validate a preview selection against a context snapshot. The client mirrors
 * the same checks for instant feedback; the Host-side copy is unit-tested and
 * is the rule Task 03B will reuse for its pre-dispatch guard.
 */
export function validateExecutionSelection(
  context: ExecutionContextSnapshot,
  selection: {
    workspaceId?: string
    strategy: ExecutionStrategy
    sessionId?: string
  },
): SelectionValidation {
  if (!context.available) {
    return { ok: false, code: 'context_unavailable', message: context.reason ?? 'Execution context is unavailable.' }
  }

  const workspace = context.workspaces.find((entry) => entry.id === selection.workspaceId)
  if (workspace === undefined) {
    return { ok: false, code: 'workspace_missing', message: 'Select a workspace.' }
  }
  if (!workspace.available) {
    return {
      ok: false,
      code: 'workspace_unavailable',
      message: `Workspace '${workspace.title}' is unavailable (${workspace.availability}).`,
    }
  }

  if (selection.strategy === 'new') return { ok: true }

  const sessionId = selection.sessionId
  if (sessionId === undefined || sessionId === '') {
    return { ok: false, code: 'session_required', message: 'Select a source session.' }
  }
  const session = context.sessions.find((entry) => entry.sessionId === sessionId)
  if (session === undefined) {
    return { ok: false, code: 'session_not_found', message: 'The selected session was not found.' }
  }
  if (session.workspaceId !== workspace.id) {
    return {
      ok: false,
      code: 'session_wrong_workspace',
      message: 'The selected session does not belong to this workspace.',
    }
  }
  if (!isSessionSuitable(session, selection.strategy)) {
    return {
      ok: false,
      code: 'session_unsuitable',
      message: `The selected session cannot be used for the '${selection.strategy}' strategy.`,
    }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Host service plumbing
// ---------------------------------------------------------------------------

export interface WorkspaceEntityLike {
  readonly id: string
  readonly title: string
  readonly path: string
  readonly sessionIds: readonly string[]
  status(): Promise<'ok' | 'missing-dir'>
}

export interface WorkspaceRegistryLike {
  list(): readonly WorkspaceEntityLike[]
}

export interface PersistedSessionLike {
  readonly header: {
    readonly id: string
    readonly cwd?: string
    readonly createdAt?: number
    readonly parentSession?: string
    readonly origin?: string
  }
  readonly eventCount?: number
}

export interface SessionPersistenceLike {
  list(): Promise<readonly PersistedSessionLike[]>
}

export interface LiveSessionsLike {
  get(id: string): unknown
}

export interface SessionTitleLike {
  get(session: unknown): { readonly title?: string } | undefined
}

export interface ExecutionContextDeps {
  workspaceRegistry?: WorkspaceRegistryLike
  sessionPersistence?: SessionPersistenceLike
  sessions?: LiveSessionsLike
  sessionTitle?: SessionTitleLike
}

function unavailable(reason: string): ExecutionContextSnapshot {
  return { available: false, reason, workspaces: [], sessions: [] }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Resolve the read-only context from the composed Host services. */
export async function buildExecutionContext(
  deps: ExecutionContextDeps,
): Promise<ExecutionContextSnapshot> {
  if (deps.workspaceRegistry === undefined || deps.sessionPersistence === undefined) {
    return unavailable(
      'Execution context requires the workspace registry and session persistence services.',
    )
  }

  let entities: readonly WorkspaceEntityLike[]
  try {
    entities = deps.workspaceRegistry.list()
  } catch (error) {
    return unavailable(`Workspace list unavailable: ${describe(error)}`)
  }

  let snapshots: readonly PersistedSessionLike[]
  try {
    snapshots = await deps.sessionPersistence.list()
  } catch (error) {
    return unavailable(`Session list unavailable: ${describe(error)}`)
  }

  const workspaces: RawWorkspace[] = []
  for (const entity of entities) {
    let availability: WorkspaceAvailability = 'unknown'
    try {
      availability = (await entity.status()) === 'ok' ? 'ok' : 'missing-dir'
    } catch {
      availability = 'unknown'
    }
    workspaces.push({
      id: String(entity.id),
      title: entity.title,
      path: entity.path,
      sessionIds: entity.sessionIds.map((id) => String(id)),
      availability,
    })
  }

  const rawSnapshots: RawSessionSnapshot[] = snapshots.map((snapshot) => ({
    id: String(snapshot.header.id),
    cwd: snapshot.header.cwd,
    createdAt: snapshot.header.createdAt,
    parentSessionId:
      snapshot.header.parentSession === undefined ? undefined : String(snapshot.header.parentSession),
    origin: snapshot.header.origin,
    eventCount: snapshot.eventCount,
  }))

  const liveSessionIds: string[] = []
  const titles = new Map<string, string>()
  for (const snapshot of rawSnapshots) {
    const liveSession = deps.sessions?.get(snapshot.id)
    if (liveSession === undefined) continue
    liveSessionIds.push(snapshot.id)
    try {
      const title = deps.sessionTitle?.get(liveSession)?.title
      if (typeof title === 'string' && title.trim() !== '') titles.set(snapshot.id, title)
    } catch {
      // A title read failure must not hide the session.
    }
  }

  return assembleExecutionContext({
    workspaces,
    snapshots: rawSnapshots,
    liveSessionIds,
    titles,
  })
}
