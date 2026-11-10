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
import { detectSessionBlankState, } from './execution-context.js';
import { TodoStorageDefiniteError, TodoStorageUncertainError, } from './store.js';
/** How long a target-less dispatching record may stay unresolved before a
 * status query may treat it as interrupted. Prevents another window's poll
 * from marking an in-flight create/fork as unknown. */
export const DISPATCH_INTERRUPT_GRACE_MS = 120_000;
export const UNRESOLVED_STATUSES = [
    'prepared',
    'session_ready',
    'dispatching',
    'unknown',
];
export class ExecutionServiceError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'ExecutionServiceError';
        this.code = code;
    }
}
function describe(error) {
    return error instanceof Error ? error.message : String(error);
}
function classifyTargetStrategy(strategy) {
    if (strategy !== 'new' && strategy !== 'reuse' && strategy !== 'fork') {
        throw new ExecutionServiceError('invalid_payload', 'Unknown execution strategy.');
    }
}
export class ExecutionService {
    options;
    constructor(options) {
        this.options = options;
    }
    async createIntent(input) {
        const clientRequestId = readString(input.clientRequestId);
        const todoId = readString(input.todoId);
        const workspaceId = readString(input.workspaceId);
        const sourceSessionId = readOptionalString(input.sourceSessionId);
        const strategy = input.strategy;
        classifyTargetStrategy(strategy);
        if (clientRequestId === undefined || todoId === undefined || workspaceId === undefined) {
            throw new ExecutionServiceError('invalid_payload', 'clientRequestId, todoId and workspaceId are required.');
        }
        const typedStrategy = strategy;
        // Idempotency is keyed by the Client-generated intent id and takes
        // precedence over re-validation, so a retried HTTP call returns the
        // original record instead of creating a second execution.
        const existing = this.findByClientRequestId(clientRequestId);
        if (existing !== undefined) {
            if (existing.todoId !== todoId || existing.strategy !== typedStrategy || existing.workspaceId !== workspaceId) {
                throw new ExecutionServiceError('execution_conflict', 'This intent id was already used with different dispatch parameters.');
            }
            return existing;
        }
        const todo = this.options.todoLookup(todoId);
        if (todo === undefined)
            throw new ExecutionServiceError('todo_not_found', 'The Todo no longer exists.');
        const workspace = await this.requireWorkspace(workspaceId);
        if (typedStrategy === 'new') {
            if (sourceSessionId !== undefined) {
                throw new ExecutionServiceError('invalid_payload', 'The new-session strategy must not name a source Session.');
            }
        }
        else {
            if (sourceSessionId === undefined) {
                throw new ExecutionServiceError('source_session_required', 'Select a source Session.');
            }
            await this.requireSourceSession(workspace, sourceSessionId);
        }
        const now = this.options.clock.isoNow();
        const record = {
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
        };
        return this.durable(() => this.options.store.mutate((current) => {
            const duplicate = current.find((entry) => entry.clientRequestId === clientRequestId);
            if (duplicate !== undefined) {
                return { next: current, result: duplicate };
            }
            // Server-side duplicate protection: a Todo with an unresolved execution
            // cannot start another one, even from another window/tab. The user must
            // first recover or explicitly abandon the unresolved execution.
            const unresolved = current.find((entry) => entry.todoId === todoId && UNRESOLVED_STATUSES.includes(entry.status));
            if (unresolved !== undefined) {
                throw new ExecutionServiceError('execution_unresolved', `This Todo already has an unresolved execution (${unresolved.executionId}). ` +
                    'Recover it or explicitly abandon it before starting a new execution.');
            }
            return { next: [...current, record], result: record };
        }));
    }
    async markSessionReady(executionId, sessionId) {
        const existing = this.requireRecord(executionId);
        if (existing.targetSessionId === sessionId)
            return existing;
        if (existing.status !== 'prepared' &&
            existing.status !== 'session_ready' &&
            existing.status !== 'dispatching' &&
            existing.status !== 'unknown') {
            throw new ExecutionServiceError('invalid_transition', 'This execution cannot record a target Session.');
        }
        const workspace = await this.requireWorkspace(existing.workspaceId);
        const snapshot = await this.requireSessionSnapshot(sessionId);
        this.assertWorkspaceMember(workspace, snapshot, 'target_session_wrong_workspace');
        if (existing.strategy === 'new') {
            const blankState = await this.blankStateOf(snapshot);
            if (blankState !== 'blank') {
                throw new ExecutionServiceError('target_session_not_blank', 'The new Session must still be blank before its first prompt.');
            }
            this.assertCreatedAfterIntent(existing, snapshot, 'target_session_before_intent');
        }
        else if (existing.strategy === 'reuse') {
            if (existing.sourceSessionId !== sessionId) {
                throw new ExecutionServiceError('target_session_wrong_workspace', 'Reuse must dispatch into the selected source Session.');
            }
        }
        else if (existing.sourceSessionId === sessionId) {
            throw new ExecutionServiceError('target_session_already_bound', 'A fork target must be the new child Session.');
        }
        else {
            this.assertCreatedAfterIntent(existing, snapshot, 'target_session_before_intent');
        }
        return this.transition(executionId, (current, all) => {
            if (current.status === 'accepted')
                return current;
            if (current.targetSessionId !== undefined) {
                if (current.targetSessionId === sessionId)
                    return current;
                throw new ExecutionServiceError('target_session_already_bound', 'This execution already has a different target Session.');
            }
            if (current.status !== 'prepared' &&
                current.status !== 'session_ready' &&
                current.status !== 'dispatching' &&
                current.status !== 'unknown') {
                throw new ExecutionServiceError('invalid_transition', 'This execution cannot record a target Session.');
            }
            if (this.boundElsewhere(all, sessionId, executionId)) {
                throw new ExecutionServiceError('target_session_already_bound', 'This Session is already bound to another execution.');
            }
            return {
                ...current,
                targetSessionId: sessionId,
                status: 'session_ready',
                bindingSource: 'client',
                errorCode: undefined,
            };
        });
    }
    /**
     * Mark the execution as dispatching before the Client performs the
     * non-idempotent create/fork. This makes a retried intent (same
     * clientRequestId) return a non-prepared record instead of allowing the
     * Client to create a second Session.
     */
    async beginDispatching(executionId) {
        return this.transition(executionId, (current) => {
            if (current.status === 'dispatching' || current.status === 'accepted')
                return current;
            if (current.status !== 'prepared' && current.status !== 'session_ready') {
                throw new ExecutionServiceError('invalid_transition', 'Only prepared or session_ready executions can start dispatching.');
            }
            return { ...current, status: 'dispatching' };
        });
    }
    async reportPromptResult(executionId, report) {
        const existing = this.requireRecord(executionId);
        if (existing.status === 'accepted')
            return existing;
        if (report.outcome !== 'accepted' && report.outcome !== 'failed' && report.outcome !== 'unknown') {
            throw new ExecutionServiceError('invalid_payload', 'Unknown prompt result outcome.');
        }
        if (existing.targetSessionId === undefined) {
            throw new ExecutionServiceError('invalid_transition', 'A Prompt result cannot be recorded before the target Session is persisted.');
        }
        const verified = await this.verifyPromptAccepted(existing);
        let status;
        if (verified === 'accepted')
            status = 'accepted';
        else if (report.outcome === 'accepted')
            status = 'dispatching';
        else if (report.outcome === 'failed')
            status = 'failed';
        else
            status = 'unknown';
        // Late failed/unknown callbacks must never overwrite an accepted record.
        return this.transition(executionId, (current) => {
            if (current.status === 'accepted')
                return current;
            if (current.status === 'prepared') {
                throw new ExecutionServiceError('invalid_transition', 'A Prompt result cannot be recorded before a Session is prepared for dispatch.');
            }
            if (current.status === 'failed' && status !== 'accepted')
                return current;
            return {
                ...current,
                status,
                errorCode: status === 'accepted' ? undefined : report.errorCode,
            };
        });
    }
    async markUnknown(executionId, errorCode) {
        return this.transition(executionId, (current) => {
            if (current.status === 'accepted')
                return current;
            if (current.status === 'failed')
                return current;
            return { ...current, status: 'unknown', errorCode };
        });
    }
    async markFailed(executionId, errorCode) {
        return this.transition(executionId, (current) => {
            if (current.status === 'accepted')
                return current;
            if (current.status === 'failed')
                return current;
            return { ...current, status: 'failed', errorCode };
        });
    }
    /** Read status, opportunistically verifying a pending prompt from the log. */
    async getStatus(executionId) {
        const existing = this.requireRecord(executionId);
        if (existing.status === 'accepted')
            return existing;
        if (existing.status === 'unknown' && existing.targetSessionId !== undefined) {
            const verified = await this.verifyPromptAccepted(existing);
            if (verified === 'accepted') {
                return this.transition(executionId, (current) => {
                    if (current.status === 'accepted')
                        return current;
                    if (current.status !== 'unknown' && current.status !== 'dispatching')
                        return current;
                    return { ...current, status: 'accepted', errorCode: undefined };
                });
            }
            return existing;
        }
        if (existing.status !== 'dispatching')
            return existing;
        if (existing.targetSessionId === undefined) {
            // A concurrent create/fork may still be running. Only an aged record can
            // be treated as interrupted; otherwise a status poll would incorrectly
            // mark in-flight work as unknown.
            if (!this.interruptGraceElapsed(existing))
                return existing;
            return this.transition(executionId, (current) => {
                if (current.status !== 'dispatching' || current.targetSessionId !== undefined)
                    return current;
                if (!this.interruptGraceElapsed(current))
                    return current;
                return { ...current, status: 'unknown', errorCode: 'dispatch_interrupted' };
            });
        }
        const verified = await this.verifyPromptAccepted(existing);
        if (verified !== 'accepted')
            return existing;
        return this.transition(executionId, (current) => {
            if (current.status === 'accepted')
                return current;
            if (current.status !== 'dispatching' && current.status !== 'unknown')
                return current;
            return { ...current, status: 'accepted', errorCode: undefined };
        });
    }
    /**
     * Explicitly give up an unresolved execution so a brand-new independent
     * execution may be created. Never allowed for accepted records; a created
     * Session is kept (never deleted) and the record says so.
     */
    async abandonExecution(executionId) {
        return this.transition(executionId, (current) => {
            if (current.status === 'accepted') {
                throw new ExecutionServiceError('abandon_not_allowed', 'An accepted execution cannot be abandoned.');
            }
            if (current.status === 'dispatching') {
                throw new ExecutionServiceError('invalid_transition', 'An in-flight dispatch cannot be abandoned; check its status first.');
            }
            if (current.status === 'failed')
                return current;
            return {
                ...current,
                status: 'failed',
                errorCode: current.targetSessionId === undefined ? 'user_abandoned' : 'user_abandoned_session_kept',
            };
        });
    }
    listForTodo(todoId) {
        return this.options.store
            .read()
            .filter((record) => record.todoId === todoId)
            .sort((left, right) => right.createdAtMs - left.createdAtMs);
    }
    /** Sessions created after an unknown create/fork result, for manual binding. */
    async candidates(executionId) {
        const record = this.requireRecord(executionId);
        if (record.status !== 'unknown') {
            throw new ExecutionServiceError('invalid_transition', 'Candidates are only listed for unknown outcomes.');
        }
        if (record.strategy === 'reuse') {
            throw new ExecutionServiceError('invalid_transition', 'Reuse executions always target their source Session and have no candidates.');
        }
        const persistence = this.options.sessionPersistence;
        if (persistence === undefined) {
            throw new ExecutionServiceError('execution_unavailable', 'Session persistence is unavailable.');
        }
        const snapshots = await persistence.list();
        const currentRecords = this.options.store.read();
        const bound = new Set(currentRecords
            .filter((entry) => entry.executionId !== record.executionId && entry.targetSessionId !== undefined)
            .map((entry) => entry.targetSessionId));
        const candidates = [];
        for (const snapshot of snapshots) {
            const sessionId = String(snapshot.header.id);
            if (sessionId === record.sourceSessionId)
                continue;
            if (bound.has(sessionId))
                continue;
            if (snapshot.header.origin === 'subagent')
                continue;
            if (snapshot.header.cwd !== record.workspacePath)
                continue;
            if (typeof snapshot.header.createdAt === 'number' && snapshot.header.createdAt < record.createdAtMs)
                continue;
            const blankState = await this.blankStateOf(snapshot);
            // Re-check the original strategy in the candidate list as well, so the UI
            // never offers a Session that could not legally be bound either way.
            if (record.strategy === 'new' && blankState !== 'blank')
                continue;
            if (record.strategy === 'fork' && blankState === 'blank')
                continue;
            candidates.push({
                sessionId,
                createdAt: snapshot.header.createdAt,
                blankState,
                title: this.liveTitle(sessionId),
                manualBinding: true,
            });
        }
        candidates.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));
        return candidates;
    }
    /** Explicit user selection of a candidate for an unknown execution. */
    async bindCandidate(executionId, sessionId) {
        const record = this.requireRecord(executionId);
        if (record.status !== 'unknown') {
            throw new ExecutionServiceError('invalid_transition', 'Only an unknown execution can be bound manually.');
        }
        if (record.strategy === 'reuse') {
            throw new ExecutionServiceError('invalid_transition', 'Reuse executions must use their original source Session.');
        }
        if (record.sourceSessionId === sessionId) {
            throw new ExecutionServiceError('candidate_not_found', 'A fork candidate cannot be the source Session.');
        }
        const persistence = this.options.sessionPersistence;
        if (persistence === undefined) {
            throw new ExecutionServiceError('execution_unavailable', 'Session persistence is unavailable.');
        }
        const workspace = await this.requireWorkspace(record.workspaceId);
        const snapshot = await this.requireSessionSnapshot(sessionId);
        this.assertWorkspaceMember(workspace, snapshot, 'target_session_wrong_workspace');
        if (snapshot.header.origin === 'subagent') {
            throw new ExecutionServiceError('candidate_not_found', 'Subagent Sessions cannot be selected.');
        }
        this.assertCreatedAfterIntent(record, snapshot, 'candidate_not_found');
        const blankState = await this.blankStateOf(snapshot);
        if (record.strategy === 'new' && blankState !== 'blank') {
            throw new ExecutionServiceError('candidate_not_found', 'A new-session execution needs a blank candidate Session.');
        }
        if (record.strategy === 'fork' && blankState === 'blank') {
            throw new ExecutionServiceError('candidate_not_found', 'A fork child candidate cannot be blank.');
        }
        return this.transition(executionId, (current, all) => {
            if (current.status !== 'unknown') {
                throw new ExecutionServiceError('invalid_transition', 'Only an unknown execution can be bound manually.');
            }
            if (current.targetSessionId !== undefined) {
                throw new ExecutionServiceError('target_session_already_bound', 'This execution already has a different target Session.');
            }
            if (this.boundElsewhere(all, sessionId, executionId)) {
                throw new ExecutionServiceError('target_session_already_bound', 'This Session is already bound to another execution.');
            }
            return {
                ...current,
                targetSessionId: sessionId,
                status: 'session_ready',
                bindingSource: 'manual',
                errorCode: undefined,
            };
        });
    }
    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------
    requireRecord(executionId) {
        const record = this.options.store.read().find((entry) => entry.executionId === executionId);
        if (record === undefined)
            throw new ExecutionServiceError('execution_not_found', 'Execution was not found.');
        return record;
    }
    findByClientRequestId(clientRequestId) {
        return this.options.store.read().find((entry) => entry.clientRequestId === clientRequestId);
    }
    /**
     * Run a state decision inside the serialized store mutation. Every status
     * check and write below must happen through this helper so concurrent
     * callbacks cannot interleave between a check and its update.
     */
    transition(executionId, decide) {
        return this.durable(() => this.options.store.mutate((current) => {
            const index = current.findIndex((entry) => entry.executionId === executionId);
            if (index === -1)
                throw new ExecutionServiceError('execution_not_found', 'Execution was not found.');
            const decided = decide(current[index], current);
            const updated = { ...decided, updatedAt: this.options.clock.isoNow() };
            const next = current.slice();
            next[index] = updated;
            return { next, result: updated };
        }));
    }
    boundElsewhere(records, sessionId, executionId) {
        return records.some((entry) => entry.executionId !== executionId &&
            entry.targetSessionId === sessionId &&
            entry.status !== 'failed');
    }
    interruptGraceElapsed(record) {
        const updatedAt = Date.parse(record.updatedAt);
        if (!Number.isFinite(updatedAt))
            return true;
        return this.options.clock.epochMs() - updatedAt >= DISPATCH_INTERRUPT_GRACE_MS;
    }
    assertCreatedAfterIntent(record, snapshot, code) {
        if (typeof snapshot.header.createdAt !== 'number')
            return;
        if (snapshot.header.createdAt >= record.createdAtMs)
            return;
        throw new ExecutionServiceError(code, code === 'candidate_not_found'
            ? 'This Session predates the execution intent.'
            : 'The target Session predates the execution intent.');
    }
    async requireWorkspace(workspaceId) {
        const registry = this.options.workspaceRegistry;
        if (registry === undefined) {
            throw new ExecutionServiceError('execution_unavailable', 'The workspace registry is unavailable.');
        }
        const workspace = registry.get?.(workspaceId) ?? registry.list().find((entry) => entry.id === workspaceId);
        if (workspace === undefined) {
            throw new ExecutionServiceError('workspace_not_found', 'The selected Workspace no longer exists.');
        }
        let status;
        try {
            status = await workspace.status();
        }
        catch {
            throw new ExecutionServiceError('workspace_unavailable', 'The selected Workspace could not be checked.');
        }
        if (status !== 'ok') {
            throw new ExecutionServiceError('workspace_unavailable', 'The selected Workspace directory is unavailable.');
        }
        return workspace;
    }
    async requireSourceSession(workspace, sourceSessionId) {
        const snapshot = await this.requireSessionSnapshot(sourceSessionId);
        this.assertWorkspaceMember(workspace, snapshot, 'source_session_wrong_workspace');
        const blankState = await this.blankStateOf(snapshot);
        if (blankState === 'blank') {
            throw new ExecutionServiceError('source_session_blank', 'The selected Session is blank; use the new-session strategy.');
        }
        if (blankState === 'unknown') {
            throw new ExecutionServiceError('source_session_state_unknown', 'The selected Session state could not be confirmed; it is not offered (conservative).');
        }
        return snapshot;
    }
    async requireSessionSnapshot(sessionId) {
        const persistence = this.options.sessionPersistence;
        if (persistence === undefined) {
            throw new ExecutionServiceError('execution_unavailable', 'Session persistence is unavailable.');
        }
        let snapshots;
        try {
            snapshots = await persistence.list();
        }
        catch (error) {
            throw new ExecutionServiceError('execution_unavailable', `Session list unavailable: ${describe(error)}`);
        }
        const snapshot = snapshots.find((entry) => String(entry.header.id) === sessionId);
        if (snapshot === undefined) {
            throw new ExecutionServiceError('target_session_not_found', 'The Session was not found.');
        }
        return snapshot;
    }
    assertWorkspaceMember(workspace, snapshot, code) {
        const member = workspace.sessionIds.map(String).includes(String(snapshot.header.id));
        const samePath = snapshot.header.cwd === workspace.path;
        if (member || samePath)
            return;
        throw new ExecutionServiceError(code, code === 'source_session_wrong_workspace'
            ? 'The selected Session does not belong to the Workspace.'
            : 'The target Session does not belong to the Workspace.');
    }
    async blankStateOf(snapshot) {
        const persistence = this.options.sessionPersistence;
        if (persistence === undefined)
            return 'unknown';
        return detectSessionBlankState(snapshot, persistence);
    }
    liveTitle(sessionId) {
        const live = this.options.sessions?.get(sessionId);
        if (live === undefined)
            return undefined;
        try {
            return this.options.sessionTitle?.get(live)?.title?.trim() || undefined;
        }
        catch {
            return undefined;
        }
    }
    /**
     * Independently verify prompt acceptance from the stored Session log: the
     * Host echoes the Remote prompt `requestId` as the durable user message
     * source's `rpcId`.
     */
    async verifyPromptAccepted(record) {
        const sessionId = record.targetSessionId;
        const persistence = this.options.sessionPersistence;
        if (sessionId === undefined || persistence?.open === undefined)
            return 'unknown';
        let handle;
        try {
            handle = await persistence.open(sessionId, 'read');
        }
        catch {
            return 'unknown';
        }
        try {
            const pageSize = 200;
            const limit = 20_000;
            let offset = 0;
            let scanned = 0;
            while (scanned < limit) {
                const page = await handle.read(offset, pageSize);
                const events = page.events;
                if (events.length === 0)
                    return 'not-found';
                for (const event of events) {
                    if (event.type !== 'user/message')
                        continue;
                    const data = event.data;
                    if (typeof data?.source?.rpcId === 'string' && data.source.rpcId === record.requestId) {
                        return 'accepted';
                    }
                }
                scanned += events.length;
                offset += events.length;
                if (events.length < pageSize)
                    return 'not-found';
            }
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
                // Closing a read handle cannot change the verification result.
            }
        }
    }
    async durable(operation) {
        try {
            return await operation();
        }
        catch (error) {
            if (error instanceof ExecutionServiceError)
                throw error;
            if (error instanceof TodoStorageUncertainError) {
                throw new ExecutionServiceError('storage_uncertain', 'The execution record result is unknown. Reload or restart DSH before retrying.');
            }
            if (error instanceof TodoStorageDefiniteError) {
                throw new ExecutionServiceError('storage_failed', 'The execution record was not saved.');
            }
            throw new ExecutionServiceError('storage_failed', `Execution record storage failed: ${describe(error)}`);
        }
    }
}
function readString(value) {
    return typeof value === 'string' && value.trim() !== '' && value.length <= 128 ? value : undefined;
}
function readOptionalString(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    return typeof value === 'string' && value.length <= 128 ? value : undefined;
}
/** Immutable prompt snapshot: title plus optional description. */
export function buildPromptSnapshot(todo) {
    return todo.description === '' ? todo.title : `${todo.title}\n\n${todo.description}`;
}
