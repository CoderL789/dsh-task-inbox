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
import type { ExecutionContextProvider, ExecutionContextSnapshot } from './execution-context.js'
import { ExecutionServiceError, type ExecutionService } from './execution-service.js'

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
  | { op: 'execution-context' }
  | {
      op: 'execution-intent'
      clientRequestId: string
      todoId: string
      strategy: 'new' | 'reuse' | 'fork'
      workspaceId: string
      sourceSessionId?: string
    }
  | { op: 'execution-session'; executionId: string; sessionId: string }
  | { op: 'execution-dispatching'; executionId: string }
  | { op: 'execution-acquire'; executionId: string }
  | { op: 'execution-prompt-retry'; executionId: string }
  | { op: 'execution-reuse-recover'; executionId: string }
  | { op: 'execution-result'; executionId: string; outcome: 'accepted' | 'failed' | 'unknown'; errorCode?: string }
  | { op: 'execution-status'; executionId?: string; todoId?: string }
  | { op: 'execution-candidates'; executionId: string }
  | { op: 'execution-bind'; executionId: string; sessionId: string }
  | { op: 'execution-unknown'; executionId: string; errorCode?: string }
  | { op: 'execution-failed'; executionId: string; errorCode?: string }
  | { op: 'execution-abandon'; executionId: string }

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

function readStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) return undefined
  return value
}

function readOptionalStringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  return readStringField(record, key)
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
    case 'execution-context':
      return { ok: true, operation: { op } }
    case 'execution-intent': {
      const clientRequestId = readStringField(payload, 'clientRequestId')
      const todoId = readStringField(payload, 'todoId')
      const workspaceId = readStringField(payload, 'workspaceId')
      const strategy = payload.strategy
      if (
        clientRequestId === undefined ||
        todoId === undefined ||
        workspaceId === undefined ||
        (strategy !== 'new' && strategy !== 'reuse' && strategy !== 'fork')
      ) {
        return { ok: false, code: 'invalid_payload', message: 'Invalid execution intent.' }
      }
      const sourceSessionId = readOptionalStringField(payload, 'sourceSessionId')
      return {
        ok: true,
        operation: {
          op,
          clientRequestId,
          todoId,
          strategy,
          workspaceId,
          ...(sourceSessionId === undefined ? {} : { sourceSessionId }),
        },
      }
    }
    case 'execution-session':
    case 'execution-bind': {
      const executionId = readStringField(payload, 'executionId')
      const sessionId = readStringField(payload, 'sessionId')
      if (executionId === undefined || sessionId === undefined) {
        return { ok: false, code: 'invalid_payload', message: 'executionId and sessionId are required.' }
      }
      return { ok: true, operation: { op, executionId, sessionId } }
    }
    case 'execution-dispatching':
    case 'execution-acquire':
    case 'execution-prompt-retry':
    case 'execution-reuse-recover':
    case 'execution-candidates': {
      const executionId = readStringField(payload, 'executionId')
      if (executionId === undefined) {
        return { ok: false, code: 'invalid_payload', message: 'executionId is required.' }
      }
      return { ok: true, operation: { op, executionId } }
    }
    case 'execution-result': {
      const executionId = readStringField(payload, 'executionId')
      const outcome = payload.outcome
      if (
        executionId === undefined ||
        (outcome !== 'accepted' && outcome !== 'failed' && outcome !== 'unknown')
      ) {
        return { ok: false, code: 'invalid_payload', message: 'Invalid execution result.' }
      }
      const errorCode = readOptionalStringField(payload, 'errorCode')
      return {
        ok: true,
        operation: {
          op,
          executionId,
          outcome,
          ...(errorCode === undefined ? {} : { errorCode }),
        },
      }
    }
    case 'execution-status': {
      const executionId = readOptionalStringField(payload, 'executionId')
      const todoId = readOptionalStringField(payload, 'todoId')
      if (executionId === undefined && todoId === undefined) {
        return { ok: false, code: 'invalid_payload', message: 'executionId or todoId is required.' }
      }
      return {
        ok: true,
        operation: {
          op,
          ...(executionId === undefined ? {} : { executionId }),
          ...(todoId === undefined ? {} : { todoId }),
        },
      }
    }
    case 'execution-unknown':
    case 'execution-failed':
    case 'execution-abandon': {
      const executionId = readStringField(payload, 'executionId')
      if (executionId === undefined) {
        return { ok: false, code: 'invalid_payload', message: 'executionId is required.' }
      }
      if (op === 'execution-abandon') {
        return { ok: true, operation: { op, executionId } }
      }
      const errorCode = readOptionalStringField(payload, 'errorCode')
      return {
        ok: true,
        operation: { op, executionId, ...(errorCode === undefined ? {} : { errorCode }) },
      }
    }
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

/** Execute one validated operation against the CRUD/execution services. */
export async function handleOperation(
  service: TodoService,
  operation: ApiOperation,
  executionContext?: ExecutionContextProvider,
  executionService?: ExecutionService,
): Promise<ApiResult> {
  try {
    switch (operation.op) {
      case 'list':
        return success({ todos: service.list() })
      case 'execution-context': {
        if (executionContext === undefined) {
          return failure(
            'execution_unavailable',
            'Execution configuration is not available in this profile.',
          )
        }
        let context: ExecutionContextSnapshot
        try {
          context = await executionContext.build()
        } catch (error) {
          const detail = error instanceof Error && error.message !== '' ? `: ${error.message}` : ''
          return failure(
            'execution_unavailable',
            `Execution configuration could not be loaded${detail}`,
          )
        }
        return success({ context })
      }
      case 'execution-intent': {
        if (executionService === undefined) {
          return failure('execution_unavailable', 'Execution dispatch is not available in this profile.')
        }
        const execution = await executionService.createIntent({
          clientRequestId: operation.clientRequestId,
          todoId: operation.todoId,
          strategy: operation.strategy,
          workspaceId: operation.workspaceId,
          ...(operation.sourceSessionId === undefined
            ? {}
            : { sourceSessionId: operation.sourceSessionId }),
        })
        return success({ execution })
      }
      case 'execution-session': {
        if (executionService === undefined) {
          return failure('execution_unavailable', 'Execution dispatch is not available in this profile.')
        }
        const execution = await executionService.markSessionReady(
          operation.executionId,
          operation.sessionId,
        )
        return success({ execution })
      }
      case 'execution-dispatching': {
        if (executionService === undefined) {
          return failure('execution_unavailable', 'Execution dispatch is not available in this profile.')
        }
        const execution = await executionService.beginDispatching(operation.executionId)
        return success({ execution })
      }
      case 'execution-acquire': {
        if (executionService === undefined) {
          return failure('execution_unavailable', 'Execution dispatch is not available in this profile.')
        }
        if (typeof executionService.acquireExecution !== 'function') {
          return failure('execution_unavailable', 'Execution acquisition is not available.')
        }
        const acquisition = await executionService.acquireExecution(operation.executionId)
        return success({
          execution: acquisition.execution,
          acquired: acquisition.acquired,
        })
      }
      case 'execution-prompt-retry': {
        if (executionService === undefined) {
          return failure('execution_unavailable', 'Execution dispatch is not available in this profile.')
        }
        if (typeof executionService.authorizePromptRetry !== 'function') {
          return failure('execution_unavailable', 'Prompt retry authorization is not available.')
        }
        const authorization = await executionService.authorizePromptRetry(operation.executionId)
        return success({
          execution: authorization.execution,
          authorized: authorization.authorized,
        })
      }
      case 'execution-reuse-recover': {
        if (executionService === undefined) {
          return failure('execution_unavailable', 'Execution dispatch is not available in this profile.')
        }
        if (typeof executionService.recoverReuseExecution !== 'function') {
          return failure('execution_unavailable', 'Reuse recovery is not available.')
        }
        const recovery = await executionService.recoverReuseExecution(operation.executionId)
        return success({
          execution: recovery.execution,
          recovered: recovery.recovered,
        })
      }
      case 'execution-result': {
        if (executionService === undefined) {
          return failure('execution_unavailable', 'Execution dispatch is not available in this profile.')
        }
        const execution = await executionService.reportPromptResult(operation.executionId, {
          outcome: operation.outcome,
          ...(operation.errorCode === undefined ? {} : { errorCode: operation.errorCode }),
        })
        return success({ execution })
      }
      case 'execution-status': {
        if (executionService === undefined) {
          return failure('execution_unavailable', 'Execution dispatch is not available in this profile.')
        }
        if (operation.executionId !== undefined) {
          return success({ execution: await executionService.getStatus(operation.executionId) })
        }
        return success({ executions: executionService.listForTodo(operation.todoId as string) })
      }
      case 'execution-candidates': {
        if (executionService === undefined) {
          return failure('execution_unavailable', 'Execution dispatch is not available in this profile.')
        }
        return success({ candidates: await executionService.candidates(operation.executionId) })
      }
      case 'execution-bind': {
        if (executionService === undefined) {
          return failure('execution_unavailable', 'Execution dispatch is not available in this profile.')
        }
        return success({
          execution: await executionService.bindCandidate(operation.executionId, operation.sessionId),
        })
      }
      case 'execution-unknown': {
        if (executionService === undefined) {
          return failure('execution_unavailable', 'Execution dispatch is not available in this profile.')
        }
        return success({
          execution: await executionService.markUnknown(
            operation.executionId,
            operation.errorCode,
          ),
        })
      }
      case 'execution-failed': {
        if (executionService === undefined) {
          return failure('execution_unavailable', 'Execution dispatch is not available in this profile.')
        }
        return success({
          execution: await executionService.markFailed(
            operation.executionId,
            operation.errorCode,
          ),
        })
      }
      case 'execution-abandon': {
        if (executionService === undefined) {
          return failure('execution_unavailable', 'Execution dispatch is not available in this profile.')
        }
        if (typeof executionService.abandonExecution !== 'function') {
          return failure('execution_unavailable', 'Execution abandonment is not available.')
        }
        return success({
          execution: await executionService.abandonExecution(operation.executionId),
        })
      }
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
    if (error instanceof ExecutionServiceError) {
      return failure(error.code, error.message)
    }
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
  executionContext?: ExecutionContextProvider
  executionService?: ExecutionService
}

class BodyTooLargeError extends Error {}

const BYTE_ENCODER = new TextEncoder()

function chunkBytes(chunk: unknown): Uint8Array {
  if (typeof chunk === 'string') return BYTE_ENCODER.encode(chunk)
  if (chunk instanceof Uint8Array) return chunk
  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  }
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk)
  return BYTE_ENCODER.encode(String(chunk))
}

/**
 * Read the request body as UTF-8 with an accurate BYTE limit.
 *
 * HTTP safety (Task 02 review round 2): when the limit is exceeded we must NOT
 * destroy the socket before the 413 response is flushed — a client still
 * uploading would see ECONNRESET and could miss the response. Instead the
 * reader keeps consuming (and discarding) the remaining request stream so the
 * exchange stays well-formed, reports the overflow only on `end`, and the
 * handler answers 413 with `Connection: close`. Buffered memory stays bounded
 * at the limit; only the discarded bytes stream through.
 *
 * A streaming `TextDecoder` keeps code points intact when a request chunk
 * splits a multi-byte UTF-8 sequence across `data` events.
 */
function readBody(request: NodeRequestLike): Promise<string> {
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder('utf-8')
    const parts: string[] = []
    let bytes = 0
    let tooLarge = false
    let settled = false

    request.on('data', (...args: unknown[]) => {
      if (settled) return
      const chunk = chunkBytes(args[0])
      bytes += chunk.byteLength
      if (bytes > MAX_BODY_BYTES) {
        tooLarge = true
        return
      }
      parts.push(decoder.decode(chunk, { stream: true }))
    })
    request.on('end', () => {
      if (settled) return
      settled = true
      if (tooLarge) {
        reject(new BodyTooLargeError('Request body is too large.'))
        return
      }
      parts.push(decoder.decode())
      resolve(parts.join(''))
    })
    request.on('error', (error?: unknown) => {
      if (settled) return
      settled = true
      reject(error)
    })
  })
}

function sendJson(
  response: NodeResponseLike,
  status: number,
  body: ApiEnvelope,
  extraHeaders?: Record<string, string>,
): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
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

      const result = await handleOperation(
        options.service,
        parsed.operation,
        options.executionContext,
        options.executionService,
      )
      sendJson(response, result.status, result.body)
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        // The request body has been fully consumed (and discarded) here, so the
        // response reaches the client reliably; close the connection so a
        // large-exchange socket is not reused.
        sendJson(
          response,
          413,
          {
            ok: false,
            error: { code: 'invalid_payload', message: error.message },
          },
          { connection: 'close' },
        )
        return
      }
      sendJson(response, 500, {
        ok: false,
        error: { code: 'internal_error', message: 'Unexpected Task Inbox error.' },
      })
    }
  }
}
