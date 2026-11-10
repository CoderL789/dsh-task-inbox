/**
 * Task 03B dispatch-planning helpers (pure, not wired into the runtime yet).
 *
 * These functions encode two conclusions of the Task 03B architecture
 * validation:
 *
 * 1. Before any real dispatch, the Host must re-validate the confirmed Todo,
 *    Workspace, Source Session and (after creation/fork) Target Session. The
 *    preview snapshot from Task 03A is not trusted: Todo may be deleted,
 *    Workspace renamed/removed, Session archived or changed, or the page may
 *    have been stale. `validateDispatchPreconditions` is the single rule set
 *    the Task 03B intent/result endpoints will use.
 * 2. Unnamed Sessions must be distinguishable in the picker. The Host already
 *    returns `title?` and `createdAt?`; `describeSessionChoice` defines the
 *    deterministic fallback (short id + creation time) instead of a generic
 *    "Untitled session", so two unnamed sessions are never indistinguishable.
 *
 * Everything here is data-in/data-out; no DSH service is touched.
 */

export type DispatchStrategy = 'new' | 'reuse' | 'fork'
export type BlankClassification = 'blank' | 'non-blank' | 'unknown'

export interface DispatchTodo {
  readonly id: string
  readonly title: string
}

export interface DispatchWorkspace {
  readonly id: string
  readonly path: string
  readonly available: boolean
}

export interface DispatchSession {
  readonly id: string
  readonly workspaceId: string
  readonly blankState: BlankClassification
}

export interface DispatchPreconditionInput {
  /** The user pressed the explicit confirm control. Viewing/selecting is not consent. */
  readonly confirmed: boolean
  /** Idempotency identity reused for the DSH prompt Remote call. */
  readonly requestId: string
  readonly strategy: DispatchStrategy
  readonly todo?: DispatchTodo
  readonly workspace?: DispatchWorkspace
  /** Selected source for reuse/fork. */
  readonly sourceSession?: DispatchSession
  /** Created/forked/reused target observed before dispatch (when available). */
  readonly targetSession?: DispatchSession
}

export type DispatchValidationCode =
  | 'not_confirmed'
  | 'invalid_request_id'
  | 'todo_not_found'
  | 'workspace_not_found'
  | 'workspace_unavailable'
  | 'session_required'
  | 'session_not_found'
  | 'session_wrong_workspace'
  | 'session_blank'
  | 'session_state_unknown'
  | 'session_not_blank'

export type DispatchValidation =
  | { ok: true }
  | { ok: false; code: DispatchValidationCode; message: string }

const REQUEST_ID_MAX = 128

function reject(code: DispatchValidationCode, message: string): DispatchValidation {
  return { ok: false, code, message }
}

/**
 * Re-validate one dispatch attempt against fresh Host state.
 *
 * Call it twice in Task 03B:
 * - before creating/forking a Session (`intent`), with the preview's source;
 * - after the authorized Client Remote call returns a target Session id,
 *   before recording acceptance (`result`), with that fresh target.
 */
export function validateDispatchPreconditions(
  input: DispatchPreconditionInput,
): DispatchValidation {
  if (!input.confirmed) {
    return reject('not_confirmed', 'The user has not explicitly confirmed this dispatch.')
  }
  if (input.requestId.trim() === '' || input.requestId.length > REQUEST_ID_MAX) {
    return reject('invalid_request_id', 'A non-empty request id of at most 128 characters is required.')
  }
  if (input.todo === undefined || input.todo.id.trim() === '') {
    return reject('todo_not_found', 'The Todo no longer exists.')
  }
  if (input.workspace === undefined || input.workspace.id.trim() === '') {
    return reject('workspace_not_found', 'The selected Workspace no longer exists.')
  }
  if (!input.workspace.available) {
    return reject('workspace_unavailable', 'The selected Workspace directory is unavailable.')
  }

  const checkSession = (
    session: DispatchSession | undefined,
    role: 'source' | 'target',
    requireNonBlank: boolean,
  ): DispatchValidation => {
    if (session === undefined || session.id.trim() === '') {
      return reject(
        role === 'source' ? 'session_required' : 'session_not_found',
        role === 'source'
          ? 'The strategy requires a source Session.'
          : 'The target Session is missing.',
      )
    }
    if (role === 'source' && session.id.trim() === '') {
      return reject('session_not_found', 'The selected Session was not found.')
    }
    if (session.workspaceId !== input.workspace?.id) {
      return reject('session_wrong_workspace', 'The Session does not belong to the selected Workspace.')
    }
    if (requireNonBlank) {
      if (session.blankState === 'blank') {
        return reject('session_blank', 'The Session is blank and cannot be used for this strategy.')
      }
      if (session.blankState === 'unknown') {
        return reject(
          'session_state_unknown',
          'The Session state could not be confirmed; it is not offered (conservative).',
        )
      }
    } else if (session.blankState === 'non-blank') {
      // A brand-new target must still be blank before its first prompt.
      return reject('session_not_blank', 'The target Session is not fresh; refusing to reuse it as a new session.')
    }
    return { ok: true }
  }

  if (input.strategy === 'new') {
    if (input.sourceSession !== undefined) {
      return reject('session_required', 'The new-session strategy must not name a source Session.')
    }
    if (input.targetSession !== undefined) {
      return checkSession(input.targetSession, 'target', false)
    }
    return { ok: true }
  }

  const source = checkSession(input.sourceSession, 'source', true)
  if (!source.ok) return source

  if (input.strategy === 'reuse') {
    if (input.targetSession !== undefined && input.targetSession.id !== input.sourceSession?.id) {
      return reject('session_not_found', 'Reuse must dispatch into the selected source Session.')
    }
    return { ok: true }
  }

  // fork: a fresh child target is optional at intent time, validated when known.
  if (input.targetSession !== undefined) {
    if (input.targetSession.id === input.sourceSession?.id) {
      return reject('session_not_found', 'A fork target must be the new child Session.')
    }
    return checkSession(input.targetSession, 'target', false)
  }
  return { ok: true }
}

export interface SessionChoiceInput {
  readonly sessionId: string
  readonly title?: string
  readonly createdAt?: number
}

export interface SessionChoiceDescription {
  /** Primary text for the picker. */
  readonly label: string
  /** Where the primary text came from. */
  readonly primary: 'title' | 'created-time+short-id' | 'short-id'
  /** Stable short identity, always safe to show. */
  readonly shortId: string
  /** ISO creation time when the Host provided one. */
  readonly createdIso?: string
}

/** Display an unnamed Session by creation time + short id, never a bare "Untitled". */
export function describeSessionChoice(input: SessionChoiceInput): SessionChoiceDescription {
  const shortId = input.sessionId.length > 8 ? input.sessionId.slice(0, 8) : input.sessionId
  const createdIso =
    typeof input.createdAt === 'number' && Number.isFinite(input.createdAt)
      ? new Date(input.createdAt).toISOString()
      : undefined
  const title = typeof input.title === 'string' ? input.title.trim() : ''

  if (title !== '') {
    return { label: title, primary: 'title', shortId, ...(createdIso === undefined ? {} : { createdIso }) }
  }
  if (createdIso !== undefined) {
    return {
      label: `${shortId} · ${createdIso}`,
      primary: 'created-time+short-id',
      shortId,
      createdIso,
    }
  }
  return { label: shortId, primary: 'short-id', shortId }
}
