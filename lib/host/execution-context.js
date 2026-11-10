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
            const blank = stored ? (snapshot?.eventCount ?? 0) === 0 : false;
            const unavailableReasons = [];
            const warnings = [];
            if (!stored)
                unavailableReasons.push('session_not_found');
            else if (blank)
                unavailableReasons.push('blank_session');
            warnings.push('archive_state_unknown');
            warnings.push('fork_requires_completed_turn');
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
    return assembleExecutionContext({
        workspaces,
        snapshots: rawSnapshots,
        liveSessionIds,
        titles,
    });
}
