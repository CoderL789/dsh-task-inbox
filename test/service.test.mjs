import assert from 'node:assert/strict'
import test from 'node:test'

import { TodoService, TodoServiceError, REQUEST_DEDUPE_MS } from '../lib/host/service.js'

/** Whole-list state repository fake: a write replaces the complete list. */
class FakeStateRepository {
  constructor(initial = []) {
    this.todos = [...initial]
    this.failWrites = false
    this.writeCalls = 0
  }

  read() {
    return [...this.todos]
  }

  async write(todos) {
    if (this.failWrites) throw new Error('medium write failed')
    this.writeCalls += 1
    this.todos = todos.map((todo) => ({ ...todo }))
  }

  sortedIds() {
    return [...this.todos].sort((left, right) => left.order - right.order).map((todo) => todo.id)
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
  const repository = new FakeStateRepository()
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
  const { service, repository } = makeService()
  const first = await service.create({ title: '  First  ' })
  const second = await service.create({ title: 'Second', description: ' details ' })

  assert.equal(first.title, 'First')
  assert.equal(first.description, '')
  assert.equal(first.status, 'todo')
  assert.equal(first.order, 0)
  assert.equal(second.order, 1)
  assert.equal(second.description, 'details')
  assert.deepEqual(service.list().map((todo) => todo.id), [first.id, second.id])
  assert.equal(repository.writeCalls, 2)
})

test('create rejects invalid input without writing', async () => {
  const { service, repository } = makeService()
  await assert.rejects(service.create({ title: '   ' }), (error) => {
    assert.equal(error instanceof TodoServiceError, true)
    assert.equal(error.code, 'invalid_title')
    return true
  })
  assert.equal(repository.todos.length, 0)
  assert.equal(repository.writeCalls, 0)
})

test('create is idempotent for the same requestId within the window', async () => {
  const { service, repository, clock } = makeService()
  const requestId = 'request-1'
  const first = await service.create({ title: 'Only once', requestId })
  const again = await service.create({ title: 'Only once', requestId })

  assert.equal(first.id, again.id)
  assert.equal(repository.todos.length, 1)
  assert.equal(repository.writeCalls, 1)

  clock.advance(REQUEST_DEDUPE_MS + 1)
  const later = await service.create({ title: 'Only once', requestId })
  assert.notEqual(later.id, first.id)
  assert.equal(repository.todos.length, 2)
})

test('concurrent creates with the same requestId produce exactly one todo', async () => {
  const { service, repository } = makeService()
  const results = await Promise.all([
    service.create({ title: 'Double submit', requestId: 'same-id' }),
    service.create({ title: 'Double submit', requestId: 'same-id' }),
    service.create({ title: 'Double submit', requestId: 'same-id' }),
  ])

  assert.equal(results[0].id, results[1].id)
  assert.equal(results[1].id, results[2].id)
  assert.equal(repository.todos.length, 1)
  assert.equal(repository.writeCalls, 1)
})

test('idempotency cache does not resurrect a deleted todo', async () => {
  const { service, repository } = makeService()
  const created = await service.create({ title: 'Temporary', requestId: 'r-del' })
  assert.equal(await service.delete(created.id), true)

  const recreated = await service.create({ title: 'Temporary', requestId: 'r-del' })
  assert.notEqual(recreated.id, created.id)
  assert.equal(repository.todos.length, 1)
  assert.deepEqual(service.list().map((todo) => todo.id), [recreated.id])
})

test('concurrent creates with different requestIds get unique order values', async () => {
  const { service, repository } = makeService()
  const created = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      service.create({ title: `Task ${index}`, requestId: `r-${index}` }),
    ),
  )

  const ids = new Set(created.map((todo) => todo.id))
  const orders = new Set(created.map((todo) => todo.order))
  assert.equal(ids.size, 6)
  assert.equal(orders.size, 6)
  assert.deepEqual(
    [...orders].sort((left, right) => left - right),
    [0, 1, 2, 3, 4, 5],
  )
  assert.equal(repository.writeCalls, 6)
  assert.deepEqual(repository.sortedIds(), created.map((todo) => todo.id))
})

test('create reports storage failure without changing state', async () => {
  const { service, repository } = makeService()
  repository.failWrites = true
  await assert.rejects(service.create({ title: 'Lost' }), (error) => {
    assert.equal(error instanceof TodoServiceError, true)
    assert.equal(error.code, 'storage_failed')
    return true
  })
  assert.equal(repository.todos.length, 0)
})

test('update edits title and description and keeps identity fields', async () => {
  const { service, repository, clock } = makeService()
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
  assert.equal(repository.writeCalls, 2)
})

test('update rejects missing tasks and invalid content', async () => {
  const { service, repository } = makeService()
  await assert.rejects(service.update({ id: 'missing', title: 'x' }), (error) => {
    assert.equal(error.code, 'not_found')
    return true
  })

  const created = await service.create({ title: 'Keep' })
  await assert.rejects(service.update({ id: created.id, title: '' }), (error) => {
    assert.equal(error.code, 'invalid_title')
    return true
  })
  assert.equal(repository.todos[0].title, 'Keep')
})

test('delete reports whether a record existed and renumbers survivors', async () => {
  const { service } = makeService()
  const first = await service.create({ title: 'A' })
  const second = await service.create({ title: 'B' })
  const third = await service.create({ title: 'C' })

  assert.equal(await service.delete(second.id), true)
  assert.equal(await service.delete(second.id), false)
  assert.deepEqual(
    service.list().map((todo) => [todo.id, todo.order]),
    [
      [first.id, 0],
      [third.id, 1],
    ],
  )
})

test('move reorders persisted records in one atomic write', async () => {
  const { service, repository } = makeService()
  const first = await service.create({ title: 'A' })
  const second = await service.create({ title: 'B' })
  const third = await service.create({ title: 'C' })
  const writesBefore = repository.writeCalls

  const moved = await service.move(third.id, 'up')
  assert.deepEqual(moved.map((todo) => todo.id), [first.id, third.id, second.id])
  assert.deepEqual(repository.sortedIds(), [first.id, third.id, second.id])
  assert.equal(repository.writeCalls, writesBefore + 1)

  const edge = await service.move(first.id, 'up')
  assert.deepEqual(edge.map((todo) => todo.id), [first.id, third.id, second.id])
  assert.equal(repository.writeCalls, writesBefore + 1)
})

test('move rejects unknown ids', async () => {
  const { service } = makeService()
  await assert.rejects(service.move('missing', 'up'), (error) => {
    assert.equal(error.code, 'not_found')
    return true
  })
})

test('a failed move leaves the previous order completely untouched', async () => {
  const { service, repository } = makeService()
  const first = await service.create({ title: 'A' })
  const second = await service.create({ title: 'B' })
  const third = await service.create({ title: 'C' })
  const before = repository.todos.map((todo) => ({ ...todo }))

  repository.failWrites = true
  await assert.rejects(service.move(third.id, 'up'), (error) => {
    assert.equal(error.code, 'storage_failed')
    return true
  })

  assert.deepEqual(repository.todos, before)
  assert.deepEqual(repository.sortedIds(), [first.id, second.id, third.id])
})

test('concurrent move and update do not lose data or duplicate orders', async () => {
  const { service, repository } = makeService()
  const first = await service.create({ title: 'A' })
  const second = await service.create({ title: 'B' })
  const third = await service.create({ title: 'C' })

  await Promise.all([
    service.move(third.id, 'up'),
    service.update({ id: second.id, title: 'B edited' }),
  ])

  const list = service.list()
  assert.deepEqual(list.map((todo) => todo.id), [first.id, third.id, second.id])
  assert.deepEqual(list.map((todo) => todo.order), [0, 1, 2])
  assert.equal(list[2].title, 'B edited')
})

test('concurrent create and move keep every todo and unique orders', async () => {
  const { service, repository } = makeService()
  const first = await service.create({ title: 'A' })
  const second = await service.create({ title: 'B' })

  const [created] = await Promise.all([
    service.create({ title: 'C', requestId: 'r-c' }),
    service.move(second.id, 'up'),
  ])

  const list = service.list()
  assert.equal(list.length, 3)
  assert.equal(new Set(list.map((todo) => todo.order)).size, 3)
  assert.deepEqual(list.map((todo) => todo.id).sort(), [first.id, second.id, created.id].sort())
  assert.deepEqual(repository.sortedIds().length, 3)
})

test('concurrent delete and update of the same todo keep consistency', async () => {
  const { service, repository } = makeService()
  const created = await service.create({ title: 'Race' })

  // Queue order is delete then update: the delete wins and the update sees a
  // missing todo. Either way, state must not contain a half-updated record.
  const results = await Promise.allSettled([
    service.delete(created.id),
    service.update({ id: created.id, title: 'Race edited' }),
  ])

  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[0].value, true)
  assert.equal(results[1].status, 'rejected')
  assert.equal(results[1].reason.code, 'not_found')
  assert.equal(repository.todos.length, 0)
})
