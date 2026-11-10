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
import { TODO_DOMAIN_SPEC } from './domain.js'
import { DomainTodoRepository, migrateLegacyTodos, type TodoDomainLike } from './store.js'
import { TodoService } from './service.js'
import {
  API_PATH,
  createApiHandler,
  type NodeRequestLike,
  type NodeResponseLike,
} from './api.js'

export const inject = ['webServer', 'connection', 'storageDomain'] as const

interface LoggerLike {
  info?(message: string): void
  warn?(message: string): void
  error?(message: string): void
}

interface WebRouteLike {
  kind: 'exact' | 'prefix'
  path: string
  handler: (request: NodeRequestLike, response: NodeResponseLike) => void | Promise<void>
}

interface PluginContext {
  webServer: {
    register(route: WebRouteLike): () => void
  }
  connection: {
    requestRejection(request: {
      headers: Record<string, string | string[] | undefined>
    }): 401 | 403 | undefined
  }
  storageDomain: {
    open(spec: typeof TODO_DOMAIN_SPEC): Promise<TodoDomainLike>
  }
  effect(effect: () => (() => void) | void): () => void
  logger?: (name: string) => LoggerLike
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function createTodoId(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID()
  return `todo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export async function apply(ctx: PluginContext): Promise<void> {
  let domain: TodoDomainLike
  try {
    domain = await ctx.storageDomain.open(TODO_DOMAIN_SPEC)
  } catch (error) {
    ctx.logger?.('dsh-task-inbox')?.error?.(
      `task-inbox storage domain could not be opened: ${describeError(error)}`,
    )
    throw error
  }

  ctx.effect(() => () => {
    void domain.close()
  })

  try {
    await migrateLegacyTodos(domain, {
      warn: (message) => ctx.logger?.('dsh-task-inbox')?.warn?.(message),
    })
  } catch (error) {
    ctx.logger?.('dsh-task-inbox')?.error?.(
      `task-inbox v1 -> v2 data migration failed: ${describeError(error)}`,
    )
    throw error
  }

  const service = new TodoService({
    repository: new DomainTodoRepository(domain),
    clock: {
      isoNow: () => new Date().toISOString(),
      epochMs: () => Date.now(),
    },
    ids: { next: createTodoId },
  })

  const handler = createApiHandler({
    service,
    authorize: (headers) => ctx.connection.requestRejection({ headers }),
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: API_PATH,
    handler,
  }))
}
