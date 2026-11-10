/** Build candidates from already-fetched descriptors (pure, unit-tested). */
export function assembleExecutionContext(input) {
    const snapshotById = new Map();
    for (const snapshot of input.snapshots)
        snapshotById.set(snapshot.id, snapshot);
    const live = new Set(input.liveSessionIds);
    const seen = new Set();
    const workspaces = input.workspaces.map((workspace) => ({
        id: workspace.id,
        title: workspace.title,
        path: workspace.path,
        availability: workspace.availability,
        available: workspace.availability === 'ok',
    }));
    const sessions = [];
    for (const workspace of input.workspaces) {
        for (const sessionId of workspace.sessionIds) {
            if (seen.has(sessionId))
                continue;
            seen.add(sessionId);
            const snapshot = snapshotById.get(sessionId);
            // Subagent-origin sessions are not ordinary conversation candidates.
            if (snapshot?.origin === 'subagent')
                continue;
            const stored = snapshot !== undefined;
            const blankState = stored
                ? (input.blankStates.get(sessionId) ?? 'unknown')
                : 'unknown';
            const unavailableReasons = [];
            const warnings = [];
            if (!stored)
                unavailableReasons.push('session_not_found');
            else if (blankState === 'blank')
                unavailableReasons.push('blank_session');
            else if (blankState === 'unknown')
                unavailableReasons.push('session_state_unknown');
            warnings.push('archive_state_unknown');
            warnings.push('fork_requires_completed_turn');
            const usable = stored && blankState === 'non-blank';
            sessions.push({
                sessionId,
                workspaceId: workspace.id,
                title: input.titles.get(sessionId),
                createdAt: snapshot?.createdAt,
                live: live.has(sessionId),
                stored,
                blankState,
                suitableForReuse: usable,
                suitableForFork: usable,
                unavailableReasons,
                warnings,
            });
        }
    }
    return { available: true, workspaces, sessions };
}
/** Sessions belonging to one Workspace (the UI's association rule). */
export function filterSessionsForWorkspace(context, workspaceId) {
    if (workspaceId === undefined || workspaceId === '')
        return [];
    return context.sessions.filter((session) => session.workspaceId === workspaceId);
}
/** True when a session can serve as the source for the given strategy. */
export function isSessionSuitable(session, strategy) {
    if (strategy === 'reuse')
        return session.suitableForReuse;
    if (strategy === 'fork')
        return session.suitableForFork;
    return strategy === 'new';
}
/**
 * Validate a preview selection against a context snapshot. The client mirrors
 * the same checks for instant feedback; the Host-side copy is unit-tested and
 * is the rule Task 03B will reuse for its pre-dispatch guard.
 */
export function validateExecutionSelection(context, selection) {
    if (!context.available) {
        return { ok: false, code: 'context_unavailable', message: context.reason ?? 'Execution context is unavailable.' };
    }
    const workspace = context.workspaces.find((entry) => entry.id === selection.workspaceId);
    if (workspace === undefined) {
        return { ok: false, code: 'workspace_missing', message: 'Select a workspace.' };
    }
    if (!workspace.available) {
        return {
            ok: false,
            code: 'workspace_unavailable',
            message: `Workspace '${workspace.title}' is unavailable (${workspace.availability}).`,
        };
    }
    if (selection.strategy === 'new')
        return { ok: true };
    const sessionId = selection.sessionId;
    if (sessionId === undefined || sessionId === '') {
        return { ok: false, code: 'session_required', message: 'Select a source session.' };
    }
    const session = context.sessions.find((entry) => entry.sessionId === sessionId);
    if (session === undefined) {
        return { ok: false, code: 'session_not_found', message: 'The selected session was not found.' };
    }
    if (session.workspaceId !== workspace.id) {
        return {
            ok: false,
            code: 'session_wrong_workspace',
            message: 'The selected session does not belong to this workspace.',
        };
    }
    if (!isSessionSuitable(session, selection.strategy)) {
        return {
            ok: false,
            code: 'session_unsuitable',
            message: `The selected session cannot be used for the '${selection.strategy}' strategy.`,
        };
    }
    return { ok: true };
}
function unavailable(reason) {
    return { available: false, reason, workspaces: [], sessions: [] };
}
function describe(error) {
    return error instanceof Error ? error.message : String(error);
}
const BLANK_SCAN_PAGE = 200;
const BLANK_SCAN_LIMIT = 5000;
/**
 * Determine whether a stored session has started a turn, using only the
 * supported read-only persistence surface.
 *
 * `SessionPersistenceSnapshot.eventCount` is OPTIONAL: the JSONL backend's
 * `list()`/`stat()` read only the header frame, so an absent count says
 * nothing about emptiness (treating `undefined` as 0 was the Task 03A bug).
 * The authoritative check is the stored log itself: `open(id, 'read')` never
 * takes write ownership, and `SessionHandle.read()` returns the event stream.
 * `turn/start` is the same "has this session started" rule `session.create`
 * uses for blank-session reuse.
 *
 * Returns `unknown` whenever the log cannot be read, rather than guessing.
 */
export async function detectSessionBlankState(snapshot, persistence) {
    // A present, exact zero is evidence of an empty (never-started) log.
    if (snapshot.eventCount === 0)
        return 'blank';
    if (persistence.open === undefined)
        return 'unknown';
    let handle;
    try {
        handle = await persistence.open(String(snapshot.header.id), 'read');
    }
    catch {
        return 'unknown';
    }
    try {
        let offset = 0;
        let scanned = 0;
        while (scanned < BLANK_SCAN_LIMIT) {
            const page = await handle.read(offset, BLANK_SCAN_PAGE);
            const events = page.events;
            if (events.length === 0)
                return 'blank';
            if (events.some((event) => event.type === 'turn/start'))
                return 'non-blank';
            scanned += events.length;
            offset += events.length;
            if (events.length < BLANK_SCAN_PAGE)
                return 'blank';
        }
        // The first 5000 events contain no turn start; do not claim blank.
        return 'unknown';
    }
    catch {
        return 'unknown';
    }
    finally {
        try {
            await handle.close();
        }
        catch {
            // Closing a read handle cannot change the classification.
        }
    }
}
/** Resolve the read-only context from the composed Host services. */
export async function buildExecutionContext(deps) {
    if (deps.workspaceRegistry === undefined || deps.sessionPersistence === undefined) {
        return unavailable('Execution context requires the workspace registry and session persistence services.');
    }
    let entities;
    try {
        entities = deps.workspaceRegistry.list();
    }
    catch (error) {
        return unavailable(`Workspace list unavailable: ${describe(error)}`);
    }
    let snapshots;
    try {
        snapshots = await deps.sessionPersistence.list();
    }
    catch (error) {
        return unavailable(`Session list unavailable: ${describe(error)}`);
    }
    const workspaces = [];
    for (const entity of entities) {
        let availability = 'unknown';
        try {
            availability = (await entity.status()) === 'ok' ? 'ok' : 'missing-dir';
        }
        catch {
            availability = 'unknown';
        }
        workspaces.push({
            id: String(entity.id),
            title: entity.title,
            path: entity.path,
            sessionIds: entity.sessionIds.map((id) => String(id)),
            availability,
        });
    }
    const rawSnapshots = snapshots.map((snapshot) => ({
        id: String(snapshot.header.id),
        cwd: snapshot.header.cwd,
        createdAt: snapshot.header.createdAt,
        parentSessionId: snapshot.header.parentSession === undefined ? undefined : String(snapshot.header.parentSession),
        origin: snapshot.header.origin,
        eventCount: snapshot.eventCount,
    }));
    const liveSessionIds = [];
    const titles = new Map();
    for (const snapshot of rawSnapshots) {
        const liveSession = deps.sessions?.get(snapshot.id);
        if (liveSession === undefined)
            continue;
        liveSessionIds.push(snapshot.id);
        try {
            const title = deps.sessionTitle?.get(liveSession)?.title;
            if (typeof title === 'string' && title.trim() !== '')
                titles.set(snapshot.id, title);
        }
        catch {
            // A title read failure must not hide the session.
        }
    }
    // Read-only blank probe per stored session. Sequential to keep a preview
    // request from opening many log handles at once.
    const blankStates = new Map();
    for (const snapshot of snapshots) {
        blankStates.set(String(snapshot.header.id), await detectSessionBlankState(snapshot, deps.sessionPersistence));
    }
    return assembleExecutionContext({
        workspaces,
        snapshots: rawSnapshots,
        liveSessionIds,
        titles,
        blankStates,
    });
}
