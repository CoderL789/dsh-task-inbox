import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

import { API_PATH, createApiHandler } from '../lib/host/api.js'
import { TodoService } from '../lib/host/service.js'

function makeService() {
  const repository = {
    todos: [],
    read() {
      return [...this.todos]
    },
    async write(todos) {
      this.todos = todos.map((todo) => ({ ...todo }))
    },
  }
  const clock = {
    isoNow: () => '2026-11-10T09:00:00.000Z',
    epochMs: () => Date.UTC(2026, 10, 10, 9, 0, 0),
  }
  let counter = 0
  return new TodoService({
    repository,
    clock,
    ids: { next: () => `todo-${++counter}` },
  })
}

async function startServer(authorize = () => undefined) {
  const handler = createApiHandler({ service: makeService(), authorize })
  const server = http.createServer((request, response) => {
    handler(request, response).catch(() => {
      try {
        response.destroy()
      } catch {
        // ignore a socket that is already gone
      }
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    port: address.port,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

function post(port, chunks, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: API_PATH,
        method: 'POST',
        // A fresh socket per test avoids keep-alive sockets delaying server.close().
        agent: false,
        headers: { 'content-type': 'application/json', ...headers },
      },
      (response) => {
        const parts = []
        response.on('data', (chunk) => parts.push(chunk))
        response.on('end', () => {
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(parts).toString('utf8'),
          })
        })
        response.on('error', reject)
      },
    )
    request.on('error', reject)
    for (const chunk of chunks) request.write(chunk)
    request.end()
  })
}

test('real node:http round trip serves create and list', async () => {
  const server = await startServer()
  try {
    const created = await post(server.port, [
      Buffer.from(JSON.stringify({ op: 'create', title: '通过真实 HTTP', requestId: 'r1' }), 'utf8'),
    ])
    assert.equal(created.status, 200)
    const createBody = JSON.parse(created.body)
    assert.equal(createBody.ok, true)
    assert.equal(createBody.data.todo.title, '通过真实 HTTP')

    const listed = await post(server.port, [Buffer.from(JSON.stringify({ op: 'list' }), 'utf8')])
    assert.equal(JSON.parse(listed.body).data.todos.length, 1)
  } finally {
    await server.close()
  }
})

test('real node:http delivers 413 reliably for an oversized upload', async () => {
  const server = await startServer()
  try {
    const payload = Buffer.from(
      JSON.stringify({ op: 'create', title: 'x'.repeat(300 * 1024), requestId: 'r-big' }),
      'utf8',
    )
    assert.equal(payload.length > 256 * 1024, true)

    const result = await post(server.port, [payload], {
      'content-length': String(payload.length),
    })

    // The response must arrive instead of a client-side ECONNRESET.
    assert.equal(result.status, 413)
    assert.equal(result.headers.connection, 'close')
    const body = JSON.parse(result.body)
    assert.equal(body.ok, false)
    assert.equal(body.error.message, 'Request body is too large.')
  } finally {
    await server.close()
  }
})

test('real node:http delivers 413 for a chunked oversized upload', async () => {
  const server = await startServer()
  try {
    const payload = Buffer.from(
      JSON.stringify({ op: 'create', title: 'y'.repeat(300 * 1024) }),
      'utf8',
    )
    const chunks = []
    for (let offset = 0; offset < payload.length; offset += 16 * 1024) {
      chunks.push(payload.subarray(offset, offset + 16 * 1024))
    }

    const result = await post(server.port, chunks)
    assert.equal(result.status, 413)
    assert.equal(JSON.parse(result.body).error.message, 'Request body is too large.')
  } finally {
    await server.close()
  }
})

test('real node:http decodes UTF-8 split across network chunks', async () => {
  const server = await startServer()
  try {
    const body = Buffer.from(
      JSON.stringify({ op: 'create', title: '中文测试', description: '跨块传输', requestId: 'r-zh' }),
      'utf8',
    )
    const marker = Buffer.from('中', 'utf8')
    const start = body.indexOf(marker)
    const chunks = [
      body.subarray(0, start + 1),
      body.subarray(start + 1, start + 2),
      body.subarray(start + 2),
    ]

    const result = await post(server.port, chunks)
    assert.equal(result.status, 200)
    const created = JSON.parse(result.body)
    assert.equal(created.ok, true)
    assert.equal(created.data.todo.title, '中文测试')
    assert.equal(created.data.todo.description, '跨块传输')
  } finally {
    await server.close()
  }
})

test('real node:http returns 401 before reading the body', async () => {
  const server = await startServer(() => 401)
  try {
    const result = await post(server.port, [
      Buffer.from(JSON.stringify({ op: 'list' }), 'utf8'),
    ])
    assert.equal(result.status, 401)
    assert.equal(JSON.parse(result.body).error.code, 'unauthorized')
  } finally {
    await server.close()
  }
})
