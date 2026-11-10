import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import {
  API_PATH,
  MAX_BODY_BYTES,
  createApiHandler,
  handleOperation,
  parseApiPayload,
} from '../lib/host/api.js'
import { TodoService } from '../lib/host/service.js'
import { ExecutionServiceError } from '../lib/host/execution-service.js'

function makeService() {
  const repository = {
    todos: [],
    writeCalls: 0,
    read() {
      return [...this.todos]
    },
    async write(todos) {
      this.writeCalls += 1
      this.todos = todos.map((todo) => ({ ...todo }))
    },
  }
  const clock = {
    isoNow: () => '2026-11-10T09:00:00.000Z',
    epochMs: () => Date.UTC(2026, 10, 10, 9, 0, 0),
  }
  let counter = 0
  const service = new TodoService({
    repository,
    clock,
    ids: { next: () => `todo-${++counter}` },
  })
  return { service, repository }
}

test('parseApiPayload rejects malformed envelopes and operations', () => {
  for (const payload of [null, [], 'x', 42, {}, { op: 'nope' }]) {
    const result = parseApiPayload(payload)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'invalid_payload')
  }

  assert.equal(parseApiPayload({ op: 'list' }).ok, true)

  const updateMissingId = parseApiPayload({ op: 'update', title: 'x' })
  assert.equal(updateMissingId.ok, false)

  const badDirection = parseApiPayload({ op: 'move', id: 'a', direction: 'left' })
  assert.equal(badDirection.ok, false)

  const move = parseApiPayload({ op: 'move', id: 'a', direction: 'up' })
  assert.equal(move.ok, true)
  assert.equal(move.operation.direction, 'up')

  const executionContext = parseApiPayload({ op: 'execution-context' })
  assert.equal(executionContext.ok, true)
  assert.equal(executionContext.operation.op, 'execution-context')
})

test('handleOperation maps service results and business errors', async () => {
  const { service } = makeService()

  const created = await handleOperation(service, {
    op: 'create',
    title: 'Buy milk',
    description: undefined,
    requestId: 'r1',
  })
  assert.equal(created.status, 200)
  assert.equal(created.body.ok, true)
  assert.equal(created.body.data.todo.title, 'Buy milk')

  const invalid = await handleOperation(service, {
    op: 'create',
    title: '   ',
    description: undefined,
    requestId: 'r2',
  })
  assert.equal(invalid.status, 200)
  assert.equal(invalid.body.ok, false)
  assert.equal(invalid.body.error.code, 'invalid_title')

  const listed = await handleOperation(service, { op: 'list' })
  assert.equal(listed.body.data.todos.length, 1)

  const missing = await handleOperation(service, { op: 'update', id: 'missing', title: 'x' })
  assert.equal(missing.body.ok, false)
  assert.equal(missing.body.error.code, 'not_found')

  const deleted = await handleOperation(service, { op: 'delete', id: created.body.data.todo.id })
  assert.equal(deleted.body.data.deleted, true)
})

test('handleOperation serves and fails execution-context safely', async () => {
  const { service } = makeService()
  const snapshot = {
    available: true,
    workspaces: [{ id: 'ws-a', title: 'A', path: '/work/a', available: true, availability: 'ok' }],
    sessions: [],
  }
  const provided = await handleOperation(service, { op: 'execution-context' }, {
    build: async () => snapshot,
  })
  assert.equal(provided.status, 200)
  assert.equal(provided.body.ok, true)
  assert.deepEqual(provided.body.data.context, snapshot)

  const missing = await handleOperation(service, { op: 'execution-context' })
  assert.equal(missing.status, 200)
  assert.equal(missing.body.ok, false)
  assert.equal(missing.body.error.code, 'execution_unavailable')

  const failing = await handleOperation(service, { op: 'execution-context' }, {
    build: async () => {
      throw new Error('context unavailable')
    },
  })
  assert.equal(failing.body.ok, false)
  assert.equal(failing.body.error.code, 'execution_unavailable')
  assert.match(failing.body.error.message, /context unavailable/)
})

test('parseApiPayload validates execution operations', () => {
  const intent = parseApiPayload({
    op: 'execution-intent',
    clientRequestId: 'c-1',
    todoId: 'todo-1',
    strategy: 'new',
    workspaceId: 'ws-a',
  })
  assert.equal(intent.ok, true)
  assert.equal(intent.operation.op, 'execution-intent')

  for (const bad of [
    { op: 'execution-intent', clientRequestId: 'c-1', todoId: 'todo-1', strategy: 'nope', workspaceId: 'ws-a' },
    { op: 'execution-intent', todoId: 'todo-1', strategy: 'new', workspaceId: 'ws-a' },
    { op: 'execution-session', executionId: 'exec-1' },
    { op: 'execution-result', executionId: 'exec-1', outcome: 'maybe' },
    { op: 'execution-status' },
    { op: 'execution-bind', executionId: 'exec-1' },
  ]) {
    assert.equal(parseApiPayload(bad).ok, false)
  }

  assert.equal(parseApiPayload({ op: 'execution-dispatching', executionId: 'exec-1' }).ok, true)
  assert.equal(parseApiPayload({ op: 'execution-candidates', executionId: 'exec-1' }).ok, true)
  assert.equal(
    parseApiPayload({ op: 'execution-result', executionId: 'exec-1', outcome: 'accepted' }).ok,
    true,
  )
  assert.equal(parseApiPayload({ op: 'execution-status', todoId: 'todo-1' }).ok, true)
  assert.equal(parseApiPayload({ op: 'execution-abandon', executionId: 'exec-1' }).ok, true)
  assert.equal(parseApiPayload({ op: 'execution-abandon' }).ok, false)
  assert.equal(parseApiPayload({ op: 'execution-acquire', executionId: 'exec-1' }).ok, true)
  assert.equal(parseApiPayload({ op: 'execution-prompt-retry', executionId: 'exec-1' }).ok, true)
  assert.equal(parseApiPayload({ op: 'execution-acquire' }).ok, false)
  assert.equal(parseApiPayload({ op: 'execution-prompt-retry' }).ok, false)
})

test('execution operations are unavailable without the execution service', async () => {
  const { service } = makeService()
  const response = await handleOperation(service, {
    op: 'execution-intent',
    clientRequestId: 'c-1',
    todoId: 'todo-1',
    strategy: 'new',
    workspaceId: 'ws-a',
  })
  assert.equal(response.body.ok, false)
  assert.equal(response.body.error.code, 'execution_unavailable')
})

test('execution operations map service results and service errors', async () => {
  const { service } = makeService()
  const calls = []
  const executionService = {
    async createIntent(input) {
      calls.push(['createIntent', input])
      return { executionId: 'exec-1', status: 'prepared', todoId: input.todoId }
    },
    async markSessionReady(id, sessionId) {
      calls.push(['markSessionReady', id, sessionId])
      return { executionId: id, status: 'session_ready', targetSessionId: sessionId }
    },
    async beginDispatching(id) {
      calls.push(['beginDispatching', id])
      return { executionId: id, status: 'dispatching' }
    },
    async reportPromptResult(id, report) {
      calls.push(['reportPromptResult', id, report])
      return { executionId: id, status: 'accepted' }
    },
    async getStatus(id) {
      calls.push(['getStatus', id])
      return { executionId: id, status: 'accepted' }
    },
    listForTodo(todoId) {
      calls.push(['listForTodo', todoId])
      return [{ executionId: 'exec-1', todoId }]
    },
    async candidates(id) {
      calls.push(['candidates', id])
      return [{ sessionId: 'session-candidate', blankState: 'non-blank' }]
    },
    async bindCandidate(id, sessionId) {
      calls.push(['bindCandidate', id, sessionId])
      return { executionId: id, status: 'session_ready', targetSessionId: sessionId }
    },
    async markUnknown(id, errorCode) {
      calls.push(['markUnknown', id, errorCode])
      return { executionId: id, status: 'unknown' }
    },
    async markFailed(id, errorCode) {
      calls.push(['markFailed', id, errorCode])
      return { executionId: id, status: 'failed' }
    },
    async abandonExecution(id) {
      calls.push(['abandonExecution', id])
      return { executionId: id, status: 'failed', errorCode: 'user_abandoned' }
    },
    async acquireExecution(id) {
      calls.push(['acquireExecution', id])
      return { execution: { executionId: id, status: 'dispatching' }, acquired: true }
    },
    async authorizePromptRetry(id) {
      calls.push(['authorizePromptRetry', id])
      return { execution: { executionId: id, status: 'dispatching' }, authorized: false }
    },
  }

  const intent = await handleOperation(
    service,
    {
      op: 'execution-intent',
      clientRequestId: 'c-1',
      todoId: 'todo-1',
      strategy: 'new',
      workspaceId: 'ws-a',
    },
    undefined,
    executionService,
  )
  assert.equal(intent.body.ok, true)
  assert.deepEqual(intent.body.data.execution, { executionId: 'exec-1', status: 'prepared', todoId: 'todo-1' })

  const ready = await handleOperation(
    service,
    { op: 'execution-session', executionId: 'exec-1', sessionId: 'session-1' },
    undefined,
    executionService,
  )
  assert.equal(ready.body.data.execution.status, 'session_ready')

  const status = await handleOperation(
    service,
    { op: 'execution-status', todoId: 'todo-1' },
    undefined,
    executionService,
  )
  assert.equal(status.body.data.executions.length, 1)

  const candidates = await handleOperation(
    service,
    { op: 'execution-candidates', executionId: 'exec-1' },
    undefined,
    executionService,
  )
  assert.equal(candidates.body.data.candidates[0].sessionId, 'session-candidate')

  const abandoned = await handleOperation(
    service,
    { op: 'execution-abandon', executionId: 'exec-1' },
    undefined,
    executionService,
  )
  assert.equal(abandoned.body.data.execution.errorCode, 'user_abandoned')

  const acquired = await handleOperation(
    service,
    { op: 'execution-acquire', executionId: 'exec-1' },
    undefined,
    executionService,
  )
  assert.equal(acquired.body.data.acquired, true)

  const authorized = await handleOperation(
    service,
    { op: 'execution-prompt-retry', executionId: 'exec-1' },
    undefined,
    executionService,
  )
  assert.equal(authorized.body.data.authorized, false)

  const failing = {
    async createIntent() {
      throw new ExecutionServiceError('workspace_unavailable', 'workspace gone')
    },
  }
  const failure = await handleOperation(
    service,
    {
      op: 'execution-intent',
      clientRequestId: 'c-2',
      todoId: 'todo-1',
      strategy: 'new',
      workspaceId: 'ws-a',
    },
    undefined,
    failing,
  )
  assert.equal(failure.body.ok, false)
  assert.equal(failure.body.error.code, 'workspace_unavailable')
})

test('handleOperation maps unexpected errors to HTTP 500', async () => {
  const brokenService = {
    list() {
      throw new Error('boom')
    },
  }
  const result = await handleOperation(brokenService, { op: 'list' })
  assert.equal(result.status, 500)
  assert.equal(result.body.ok, false)
  assert.equal(result.body.error.code, 'internal_error')
})

function makeRequest({ method = 'POST', url = API_PATH, headers = {}, body = '' } = {}) {
  const emitter = new EventEmitter()
  const request = Object.assign(emitter, { method, url, headers })
  return { request, body }
}

function makeResponse() {
  const captured = { status: 0, headers: {}, body: undefined }
  return {
    captured,
    response: {
      writeHead(status, headers) {
        captured.status = status
        if (headers) Object.assign(captured.headers, headers)
      },
      end(body) {
        captured.body = body
      },
    },
  }
}

async function invoke(handler, request, response, body) {
  const chunks = Array.isArray(body) ? body : body === '' ? [] : [body]
  const promise = handler(request, response)
  await Promise.resolve()
  for (const chunk of chunks) request.emit('data', chunk)
  request.emit('end')
  await promise
}

test('api handler rejects unauthenticated requests before touching the service', async () => {
  const { service } = makeService()
  let listCalls = 0
  const handler = createApiHandler({
    service: {
      list: () => {
        listCalls += 1
        return service.list()
      },
    },
    authorize: () => 401,
  })
  const { request, body } = makeRequest({ body: JSON.stringify({ op: 'list' }) })
  const { response, captured } = makeResponse()
  await invoke(handler, request, response, body)

  assert.equal(captured.status, 401)
  assert.equal(listCalls, 0)
  assert.deepEqual(JSON.parse(captured.body), {
    ok: false,
    error: { code: 'unauthorized', message: 'Authentication required.' },
  })
})

test('api handler enforces method, path, JSON and payload errors', async () => {
  const { service } = makeService()
  const handler = createApiHandler({ service, authorize: () => undefined })

  const getResult = await call(handler, makeRequest({ method: 'GET', body: 'x' }))
  assert.equal(getResult.status, 405)
  assert.equal(getResult.headers.allow, 'POST')

  const wrongPath = await call(handler, makeRequest({ url: '/plugins/dsh-task-inbox/other', body: 'x' }))
  assert.equal(wrongPath.status, 404)

  const badJson = await call(handler, makeRequest({ body: 'not json' }))
  assert.equal(badJson.status, 400)
  assert.equal(JSON.parse(badJson.body).error.code, 'invalid_payload')

  const badOp = await call(handler, makeRequest({ body: JSON.stringify({ op: 'nope' }) }))
  assert.equal(badOp.status, 400)

  const oversized = await call(handler, makeRequest({ body: 'x'.repeat(300 * 1024) }))
  assert.equal(oversized.status, 413)
})

test('api handler decodes UTF-8 split across request chunks', async () => {
  const { service } = makeService()
  const handler = createApiHandler({ service, authorize: () => undefined })

  const body = JSON.stringify({
    op: 'create',
    title: '中文标题测试',
    description: '分块传输细节',
    requestId: 'r-zh',
  })
  const bytes = Buffer.from(body, 'utf8')
  const marker = Buffer.from('中', 'utf8')
  const start = bytes.indexOf(marker)
  assert.notEqual(start, -1)
  // Split through the middle of the three-byte "中" sequence, then again
  // through the next multi-byte character.
  const chunks = [
    bytes.subarray(0, start + 1),
    bytes.subarray(start + 1, start + 2),
    bytes.subarray(start + 2),
  ]

  const result = await call(handler, makeRequest({ body: chunks }))
  assert.equal(result.status, 200)
  const parsed = JSON.parse(result.body)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.data.todo.title, '中文标题测试')
  assert.equal(parsed.data.todo.description, '分块传输细节')
})

test('request body limit counts bytes, not UTF-16 string length', async () => {
  const { service } = makeService()
  const handler = createApiHandler({ service, authorize: () => undefined })

  const title = '中'.repeat(90_000) // 270 000 UTF-8 bytes, 90 000 JS chars
  const body = JSON.stringify({ op: 'create', title, requestId: 'r-big' })
  assert.equal(body.length < MAX_BODY_BYTES, true)
  assert.equal(Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES, true)

  const result = await call(handler, makeRequest({ body: Buffer.from(body, 'utf8') }))
  assert.equal(result.status, 413)
  assert.equal(JSON.parse(result.body).error.message, 'Request body is too large.')
})

test('request body limit triggers while streaming oversized chunks', async () => {
  const { service } = makeService()
  const handler = createApiHandler({ service, authorize: () => undefined })

  const body = Buffer.from(JSON.stringify({ op: 'create', title: '中'.repeat(90_000) }), 'utf8')
  const chunkSize = 32 * 1024
  const chunks = []
  for (let offset = 0; offset < body.length; offset += chunkSize) {
    chunks.push(body.subarray(offset, offset + chunkSize))
  }

  const result = await call(handler, makeRequest({ body: chunks }))
  assert.equal(result.status, 413)
})

test('api handler performs a full create/list round trip', async () => {
  const { service } = makeService()
  const handler = createApiHandler({ service, authorize: () => undefined })

  const created = await call(handler, makeRequest({
    body: JSON.stringify({ op: 'create', title: 'From HTTP', requestId: 'r1' }),
  }))
  assert.equal(created.status, 200)
  const createdBody = JSON.parse(created.body)
  assert.equal(createdBody.ok, true)
  assert.equal(createdBody.data.todo.title, 'From HTTP')

  const listed = await call(handler, makeRequest({ body: JSON.stringify({ op: 'list' }) }))
  const listedBody = JSON.parse(listed.body)
  assert.equal(listedBody.data.todos.length, 1)
})

async function call(handler, { request, body }) {
  const { response, captured } = makeResponse()
  await invoke(handler, request, response, body)
  return captured
}
