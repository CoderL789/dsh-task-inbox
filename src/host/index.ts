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
import {
  buildExecutionContext,
  type ExecutionContextProvider,
  type LiveSessionsLike,
  type SessionPersistenceLike,
  type SessionTitleLike,
  type WorkspaceRegistryLike,
} from './execution-context.js'

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
  /** Optional service lookup for services that may be absent in a profile. */
  get?<T>(name: string): T | undefined
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

  const repository = new DomainTodoRepository(domain, () => ctx.storageDomain.open(TODO_DOMAIN_SPEC))

  ctx.effect(() => () => {
    void repository.close()
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
    repository,
    clock: {
      isoNow: () => new Date().toISOString(),
      epochMs: () => Date.now(),
    },
    ids: { next: createTodoId },
  })

  // Read-only execution context for the Task 03A pre-execution preview.
  // These services are looked up optionally so the todo feature keeps working
  // in a profile that lacks workspace/session persistence.
  const executionContext: ExecutionContextProvider = {
    build: () =>
      buildExecutionContext({
        workspaceRegistry: ctx.get?.<WorkspaceRegistryLike>('workspaceRegistry'),
        sessionPersistence: ctx.get?.<SessionPersistenceLike>('sessionPersistence'),
        sessions: ctx.get?.<LiveSessionsLike>('sessions'),
        sessionTitle: ctx.get?.<SessionTitleLike>('sessionTitle'),
      }),
  }

  const handler = createApiHandler({
    service,
    executionContext,
    authorize: (headers) => ctx.connection.requestRejection({ headers }),
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: API_PATH,
    handler,
  }))
}
