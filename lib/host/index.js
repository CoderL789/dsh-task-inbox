/**
 * Host half of the DSH Task Inbox bundle (Task 02).
 *
 * Responsibilities:
 * - open the plugin-owned storage domain (`ctx.storageDomain`, JSON backend,
 *   single-file layout) and keep it for the plugin lifetime;
 * - expose the todo CRUD service through one same-origin HTTP route
 *   (`POST /plugins/dsh-task-inbox/api`);
 * - authenticate every request with `ctx.connection.requestRejection`.
 *
 * No Agent, workspace, or session APIs are used in this phase.
 */
import { TODO_DOMAIN_SPEC } from './domain.js';
import { DomainTodoRepository, migrateLegacyTodos } from './store.js';
import { TodoService } from './service.js';
import { API_PATH, createApiHandler, } from './api.js';
export const inject = ['webServer', 'connection', 'storageDomain'];
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
function createTodoId() {
    const cryptoApi = globalThis.crypto;
    if (typeof cryptoApi?.randomUUID === 'function')
        return cryptoApi.randomUUID();
    return `todo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
    const handler = createApiHandler({
        service,
        authorize: (headers) => ctx.connection.requestRejection({ headers }),
    });
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: API_PATH,
        handler,
    }));
}
