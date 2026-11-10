/**
 * The plugin's single HTTP bridge: same-origin JSON API used by the Client
 * half, authenticated through the DSH Connection service.
 *
 * The route is registered with `ctx.webServer.register` and each request is
 * checked with `ctx.connection.requestRejection` (Host/Origin trust plus the
 * signed browser cookie), so the endpoint is not reachable anonymously.
 * Business errors are returned as `{ ok: false }` envelopes with HTTP 200; the
 * Client renders them as failures and never as success.
 */
import {
  TodoService,
  TodoServiceError,
} from './service.js'
import type { Todo, MoveDirection } from './model.js'

export const API_PATH = '/plugins/dsh-task-inbox/api'
export const MAX_BODY_BYTES = 256 * 1024

export interface ApiFailureBody {
  code: string
  message: string
}

export type ApiEnvelope =
  | { ok: true; data: unknown }
  | { ok: false; error: ApiFailureBody }

export interface ApiResult {
  status: number
  body: ApiEnvelope
}

export type ApiOperation =
  | { op: 'list' }
  | { op: 'create'; title: unknown; description: unknown; requestId: unknown }
  | { op: 'update'; id: string; title: unknown; description: unknown; requestId: unknown }
  | { op: 'delete'; id: string }
  | { op: 'move'; id: string; direction: MoveDirection }

export type ParseResult =
  | { ok: true; operation: ApiOperation }
  | { ok: false; code: string; message: string }

function failure(code: string, message: string): ApiResult {
  return { status: 200, body: { ok: false, error: { code, message } } }
}

function success(data: unknown): ApiResult {
  return { status: 200, body: { ok: true, data } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readId(record: Record<string, unknown>): string | undefined {
  const id = record.id
  if (typeof id !== 'string') return undefined
  if (id.length === 0 || id.length > 128) return undefined
  return id
}

/** Validate the envelope envelope shape and operation fields. */
export function parseApiPayload(payload: unknown): ParseResult {
  if (!isRecord(payload)) {
    return { ok: false, code: 'invalid_payload', message: 'Request body must be a JSON object.' }
  }
  const op = payload.op
  if (typeof op !== 'string') {
    return { ok: false, code: 'invalid_payload', message: 'Request is missing an operation.' }
  }

  switch (op) {
    case 'list':
      return { ok: true, operation: { op } }
    case 'create':
      return {
        ok: true,
        operation: {
          op,
          title: payload.title,
          description: payload.description,
          requestId: payload.requestId,
        },
      }
    case 'update': {
      const id = readId(payload)
      if (id === undefined) {
        return { ok: false, code: 'invalid_payload', message: 'Update requires a task id.' }
      }
      return {
        ok: true,
        operation: {
          op,
          id,
          title: payload.title,
          description: payload.description,
          requestId: payload.requestId,
        },
      }
    }
    case 'delete': {
      const id = readId(payload)
      if (id === undefined) {
        return { ok: false, code: 'invalid_payload', message: 'Delete requires a task id.' }
      }
      return { ok: true, operation: { op, id } }
    }
    case 'move': {
      const id = readId(payload)
      if (id === undefined) {
        return { ok: false, code: 'invalid_payload', message: 'Move requires a task id.' }
      }
      const direction = payload.direction
      if (direction !== 'up' && direction !== 'down') {
        return {
          ok: false,
          code: 'invalid_payload',
          message: 'Move direction must be "up" or "down".',
        }
      }
      return { ok: true, operation: { op, id, direction } }
    }
    default:
      return { ok: false, code: 'invalid_payload', message: `Unknown operation: ${op}` }
  }
}

/** Execute one validated operation against the CRUD service. */
export async function handleOperation(
  service: TodoService,
  operation: ApiOperation,
): Promise<ApiResult> {
  try {
    switch (operation.op) {
      case 'list':
        return success({ todos: service.list() })
      case 'create': {
        const todo: Todo = await service.create({
          title: operation.title,
          description: operation.description,
          requestId: operation.requestId,
        })
        return success({ todo })
      }
      case 'update': {
        const todo: Todo = await service.update({
          id: operation.id,
          title: operation.title,
          description: operation.description,
          requestId: operation.requestId,
        })
        return success({ todo })
      }
      case 'delete': {
        const deleted = await service.delete(operation.id)
        return success({ deleted })
      }
      case 'move': {
        const todos = await service.move(operation.id, operation.direction)
        return success({ todos })
      }
    }
  } catch (error) {
    if (error instanceof TodoServiceError) {
      return failure(error.code, error.message)
    }
    return {
      status: 500,
      body: { ok: false, error: { code: 'internal_error', message: 'Unexpected Task Inbox error.' } },
    }
  }
}

export type AuthorizeHeaders = (
  headers: Record<string, string | string[] | undefined>,
) => 401 | 403 | undefined

/** Minimal structural views of the Node request/response used by the route. */
export interface NodeRequestLike {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  on(event: string, listener: (...args: unknown[]) => void): void
}

export interface NodeResponseLike {
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string): void
}

export interface ApiHandlerOptions {
  service: TodoService
  authorize: AuthorizeHeaders
}

class BodyTooLargeError extends Error {}

function readBody(request: NodeRequestLike): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: string[] = []
    request.on('data', (...args: unknown[]) => {
      const chunk = args[0]
      const text = typeof chunk === 'string' ? chunk : String(chunk)
      size += text.length
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLargeError('Request body is too large.'))
        return
      }
      chunks.push(text)
    })
    request.on('end', () => resolve(chunks.join('')))
    request.on('error', (error?: unknown) => reject(error))
  })
}

function sendJson(response: NodeResponseLike, status: number, body: ApiEnvelope): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(body))
}

/** Build the Node handler registered for the plugin's API route. */
export function createApiHandler(options: ApiHandlerOptions) {
  return async function handle(
    request: NodeRequestLike,
    response: NodeResponseLike,
  ): Promise<void> {
    const path = String(request.url ?? '').split('?')[0]
    if (path !== API_PATH) {
      sendJson(response, 404, { ok: false, error: { code: 'not_found', message: 'Unknown endpoint.' } })
      return
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' })
      response.end()
      return
    }

    let rejection: 401 | 403 | undefined
    try {
      rejection = options.authorize(request.headers)
    } catch {
      rejection = 401
    }
    if (rejection !== undefined) {
      sendJson(response, rejection, {
        ok: false,
        error: { code: 'unauthorized', message: 'Authentication required.' },
      })
      return
    }

    try {
      const raw = await readBody(request)
      let payload: unknown
      try {
        payload = JSON.parse(raw)
      } catch {
        sendJson(response, 400, {
          ok: false,
          error: { code: 'invalid_payload', message: 'Request body must be valid JSON.' },
        })
        return
      }

      const parsed = parseApiPayload(payload)
      if (!parsed.ok) {
        sendJson(response, 400, {
          ok: false,
          error: { code: parsed.code, message: parsed.message },
        })
        return
      }

      const result = await handleOperation(options.service, parsed.operation)
      sendJson(response, result.status, result.body)
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        sendJson(response, 413, {
          ok: false,
          error: { code: 'invalid_payload', message: error.message },
        })
        return
      }
      sendJson(response, 500, {
        ok: false,
        error: { code: 'internal_error', message: 'Unexpected Task Inbox error.' },
      })
    }
  }
}
