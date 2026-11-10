import assert from 'node:assert/strict'
import test from 'node:test'

import { TodoService, TodoServiceError, REQUEST_DEDUPE_MS } from '../lib/host/service.js'

class FakeRepository {
  constructor() {
    this.records = new Map()
    this.failWrites = false
  }

  all() {
    return [...this.records.values()]
  }

  get(id) {
    return this.records.get(id)
  }

  async put(todo) {
    if (this.failWrites) throw new Error('medium write failed')
    this.records.set(todo.id, todo)
  }

  async delete(id) {
    if (this.failWrites) throw new Error('medium write failed')
    return this.records.delete(id)
  }
}

function makeClock() {
  let ms = Date.UTC(2026, 10, 10, 9, 0, 0)
  return {
    isoNow: () => new Date(ms).toISOString(),
    epochMs: () => ms,
    advance: (delta) => {
      ms += delta
    },
  }
}

function makeService() {
  const repository = new FakeRepository()
  const clock = makeClock()
  let counter = 0
  const ids = { next: () => `todo-${++counter}` }
  return {
    repository,
    clock,
    service: new TodoService({ repository, clock, ids }),
  }
}

test('create appends a todo with normalized content and order', async () => {
  const { service } = makeService()
  const first = await service.create({ title: '  First  ' })
  const second = await service.create({ title: 'Second', description: ' details ' })

  assert.equal(first.title, 'First')
  assert.equal(first.description, '')
  assert.equal(first.status, 'todo')
  assert.equal(first.order, 0)
  assert.equal(second.order, 1)
  assert.equal(second.description, 'details')
  assert.deepEqual(service.list().map((todo) => todo.id), [first.id, second.id])
})

test('create rejects invalid input', async () => {
  const { service, repository } = makeService()
  await assert.rejects(service.create({ title: '   ' }), (error) => {
    assert.equal(error instanceof TodoServiceError, true)
    assert.equal(error.code, 'invalid_title')
    return true
  })
  assert.equal(repository.all().length, 0)
})

test('create is idempotent for the same requestId within the window', async () => {
  const { service, repository, clock } = makeService()
  const requestId = 'request-1'
  const first = await service.create({ title: 'Only once', requestId })
  const again = await service.create({ title: 'Only once', requestId })

  assert.equal(first.id, again.id)
  assert.equal(repository.all().length, 1)

  clock.advance(REQUEST_DEDUPE_MS + 1)
  const later = await service.create({ title: 'Only once', requestId })
  assert.notEqual(later.id, first.id)
  assert.equal(repository.all().length, 2)
})

test('create reports storage failure without adding a record', async () => {
  const { service, repository } = makeService()
  repository.failWrites = true
  await assert.rejects(service.create({ title: 'Lost' }), (error) => {
    assert.equal(error instanceof TodoServiceError, true)
    assert.equal(error.code, 'storage_failed')
    return true
  })
  assert.equal(repository.all().length, 0)
})

test('update edits title and description and keeps identity fields', async () => {
  const { service, clock } = makeService()
  const created = await service.create({ title: 'Original', description: 'old' })
  clock.advance(60_000)
  const updated = await service.update({
    id: created.id,
    title: ' Edited ',
    description: ' new ',
  })

  assert.equal(updated.id, created.id)
  assert.equal(updated.title, 'Edited')
  assert.equal(updated.description, 'new')
  assert.equal(updated.createdAt, created.createdAt)
  assert.equal(updated.status, 'todo')
  assert.equal(updated.order, created.order)
  assert.equal(updated.updatedAt, clock.isoNow())
})

test('update rejects missing tasks and invalid content', async () => {
  const { service } = makeService()
  await assert.rejects(service.update({ id: 'missing', title: 'x' }), (error) => {
    assert.equal(error.code, 'not_found')
    return true
  })

  const created = await service.create({ title: 'Keep' })
  await assert.rejects(service.update({ id: created.id, title: '' }), (error) => {
    assert.equal(error.code, 'invalid_title')
    return true
  })
})

test('delete reports whether a record existed', async () => {
  const { service } = makeService()
  const created = await service.create({ title: 'Remove me' })
  assert.equal(await service.delete(created.id), true)
  assert.equal(await service.delete(created.id), false)
  assert.equal(service.list().length, 0)
})

test('move reorders persisted records and returns the new list', async () => {
  const { service, repository } = makeService()
  const first = await service.create({ title: 'A' })
  const second = await service.create({ title: 'B' })
  const third = await service.create({ title: 'C' })

  const moved = await service.move(third.id, 'up')
  assert.deepEqual(moved.map((todo) => todo.id), [first.id, third.id, second.id])
  assert.deepEqual(
    [...repository.all()].sort((left, right) => left.order - right.order).map((todo) => todo.id),
    [first.id, third.id, second.id],
  )

  const edge = await service.move(first.id, 'up')
  assert.deepEqual(edge.map((todo) => todo.id), [first.id, third.id, second.id])
})

test('move rejects unknown ids', async () => {
  const { service } = makeService()
  await assert.rejects(service.move('missing', 'up'), (error) => {
    assert.equal(error.code, 'not_found')
    return true
  })
})
