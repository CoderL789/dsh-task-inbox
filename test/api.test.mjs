import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import {
  API_PATH,
  createApiHandler,
  handleOperation,
  parseApiPayload,
} from '../lib/host/api.js'
import { TodoService } from '../lib/host/service.js'

function makeService() {
  const records = new Map()
  const clock = {
    isoNow: () => '2026-11-10T09:00:00.000Z',
    epochMs: () => Date.UTC(2026, 10, 10, 9, 0, 0),
  }
  let counter = 0
  const repository = {
    all: () => [...records.values()],
    get: (id) => records.get(id),
    put: async (todo) => {
      records.set(todo.id, todo)
    },
    delete: async (id) => records.delete(id),
  }
  const service = new TodoService({
    repository,
    clock,
    ids: { next: () => `todo-${++counter}` },
  })
  return { service, records }
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
  const promise = handler(request, response)
  await Promise.resolve()
  if (body !== '') request.emit('data', body)
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
