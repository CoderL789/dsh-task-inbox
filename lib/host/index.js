/**
 * Host half of the DSH Task Inbox bundle (Task 02/03B).
 *
 * Responsibilities:
 * - keep the Todo domain (`task_inbox`) untouched and add the separate
 *   execution-record domain (`task_inbox_executions`);
 * - serve Todo CRUD + execution coordination over one authenticated route;
 * - re-validate dispatch intents and independently verify prompt acceptance;
 * - never call a Remote Session method from the Host.
 */
import { TODO_DOMAIN_SPEC } from './domain.js';
import { DomainTodoRepository, migrateLegacyTodos } from './store.js';
import { TodoService } from './service.js';
import { API_PATH, createApiHandler, } from './api.js';
import { buildExecutionContext, } from './execution-context.js';
import { EXECUTION_DOMAIN_SPEC, DomainExecutionRepository, ExecutionStore, } from './execution-store.js';
import { ExecutionService } from './execution-service.js';
export const inject = ['webServer', 'connection', 'storageDomain'];
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
function createLocalId(prefix) {
    const cryptoApi = globalThis.crypto;
    if (typeof cryptoApi?.randomUUID === 'function')
        return cryptoApi.randomUUID();
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function createTodoId() {
    return createLocalId('todo');
}
export async function apply(ctx) {
    let domain;
    try {
        domain = await ctx.storageDomain.open(TODO_DOMAIN_SPEC);
    }
    catch (error) {
        ctx.logger?.('dsh-task-inbox')?.error?.(`task-inbox storage domain could not be opened: ${describeError(error)}`);
        throw error;
    }
    const repository = new DomainTodoRepository(domain, () => ctx.storageDomain.open(TODO_DOMAIN_SPEC));
    ctx.effect(() => () => {
        void repository.close();
    });
    try {
        await migrateLegacyTodos(domain, {
            warn: (message) => ctx.logger?.('dsh-task-inbox')?.warn?.(message),
        });
    }
    catch (error) {
        ctx.logger?.('dsh-task-inbox')?.error?.(`task-inbox v1 -> v2 data migration failed: ${describeError(error)}`);
        throw error;
    }
    const service = new TodoService({
        repository,
        clock: {
            isoNow: () => new Date().toISOString(),
            epochMs: () => Date.now(),
        },
        ids: { next: createTodoId },
    });
    // Read-only execution context for the Task 03A pre-execution preview.
    // These services are looked up optionally so the todo feature keeps working
    // in a profile that lacks workspace/session persistence.
    const executionContext = {
        build: () => buildExecutionContext({
            workspaceRegistry: ctx.get?.('workspaceRegistry'),
            sessionPersistence: ctx.get?.('sessionPersistence'),
            sessions: ctx.get?.('sessions'),
            sessionTitle: ctx.get?.('sessionTitle'),
        }),
    };
    // Task 03B: execution records live in their own domain, so the existing
    // Todo domain (and its data) is never migrated, rewritten or reset. A
    // failure to open it only disables dispatch, not Task CRUD.
    let executionService;
    try {
        const executionDomain = await ctx.storageDomain.open(EXECUTION_DOMAIN_SPEC);
        const executionRepository = new DomainExecutionRepository(executionDomain, () => ctx.storageDomain.open(EXECUTION_DOMAIN_SPEC));
        ctx.effect(() => () => {
            void executionRepository.close();
        });
        const executionStore = new ExecutionStore(executionRepository);
        executionService = new ExecutionService({
            store: executionStore,
            todoLookup: (id) => {
                try {
                    return service.list().find((todo) => todo.id === id);
                }
                catch {
                    return undefined;
                }
            },
            // Resolve lifecycle services at use time: workspaceRegistry and friends
            // may become active after this plugin's apply() runs.
            workspaceRegistry: () => ctx.get?.('workspaceRegistry'),
            sessionPersistence: () => ctx.get?.('sessionPersistence'),
            sessions: () => ctx.get?.('sessions'),
            sessionTitle: () => ctx.get?.('sessionTitle'),
            clock: {
                isoNow: () => new Date().toISOString(),
                epochMs: () => Date.now(),
            },
            ids: {
                executionId: () => createLocalId('exec'),
                requestId: () => createLocalId('req'),
            },
        });
    }
    catch (error) {
        ctx.logger?.('dsh-task-inbox')?.warn?.(`task-inbox execution storage is unavailable (dispatch disabled): ${describeError(error)}`);
    }
    const handler = createApiHandler({
        service,
        executionContext,
        ...(executionService === undefined ? {} : { executionService }),
        authorize: (headers) => ctx.connection.requestRejection({ headers }),
    });
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: API_PATH,
        handler,
    }));
}
