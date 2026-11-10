import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compareTodos,
  nextOrder,
  normalizeOrder,
  normalizeTodoInput,
  planMove,
  sortTodos,
  DESCRIPTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
} from '../lib/host/model.js'
import { TODO_DOMAIN_SPEC } from '../lib/host/domain.js'

function todo(id, order, createdAt = '2026-11-10T09:00:00.000Z') {
  return {
    id,
    title: `Task ${id}`,
    description: '',
    status: 'todo',
    createdAt,
    updatedAt: createdAt,
    order,
  }
}

test('normalizeTodoInput trims title and defaults description', () => {
  const result = normalizeTodoInput({ title: '  Buy milk  ' })
  assert.equal(result.ok, true)
  assert.equal(result.value.title, 'Buy milk')
  assert.equal(result.value.description, '')
})

test('normalizeTodoInput rejects empty and non-string titles', () => {
  for (const title of ['', '   ', undefined, null, 42]) {
    const result = normalizeTodoInput({ title })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'invalid_title')
  }
})

test('normalizeTodoInput enforces length limits', () => {
  const longTitle = normalizeTodoInput({ title: 'a'.repeat(TITLE_MAX_LENGTH + 1) })
  assert.equal(longTitle.ok, false)
  assert.equal(longTitle.code, 'invalid_title')

  assert.equal(normalizeTodoInput({ title: 'a'.repeat(TITLE_MAX_LENGTH) }).ok, true)

  const longDescription = normalizeTodoInput({
    title: 'ok',
    description: 'b'.repeat(DESCRIPTION_MAX_LENGTH + 1),
  })
  assert.equal(longDescription.ok, false)
  assert.equal(longDescription.code, 'invalid_description')

  const badDescription = normalizeTodoInput({ title: 'ok', description: 12 })
  assert.equal(badDescription.ok, false)
  assert.equal(badDescription.code, 'invalid_description')
})

test('sortTodos orders by order, then createdAt, then id', () => {
  const first = todo('b', 1, '2026-11-10T09:00:00.000Z')
  const second = todo('a', 1, '2026-11-10T08:00:00.000Z')
  const third = todo('c', 0, '2026-11-10T09:00:00.000Z')
  const sorted = sortTodos([first, second, third])
  assert.deepEqual(sorted.map((item) => item.id), ['c', 'a', 'b'])
  assert.equal(compareTodos(sorted[0], sorted[1]) < 0, true)
})

test('nextOrder appends after the highest order', () => {
  assert.equal(nextOrder([]), 0)
  assert.equal(nextOrder([todo('a', 0), todo('b', 4)]), 5)
})

test('normalizeOrder assigns positions without touching timestamps', () => {
  const updatedAt = '2026-11-10T10:00:00.000Z'
  const items = [
    todo('a', 3, '2026-11-10T09:00:00.000Z'),
    todo('b', 7, '2026-11-10T08:00:00.000Z'),
  ]
  items[0].updatedAt = updatedAt
  const normalized = normalizeOrder(items)
  assert.deepEqual(normalized.map((item) => item.order), [0, 1])
  assert.equal(normalized[0].updatedAt, updatedAt)
  assert.equal(normalized[0].id, 'a')
})

test('planMove swaps adjacent items and renumbers every position', () => {
  const updatedAt = '2026-11-10T10:00:00.000Z'
  const items = [todo('a', 0), todo('b', 1), todo('c', 2)]

  const moveDown = planMove(items, 'a', 'down', updatedAt)
  assert.deepEqual(moveDown.todos.map((item) => [item.id, item.order]), [
    ['b', 0],
    ['a', 1],
    ['c', 2],
  ])
  assert.equal(moveDown.changed.length, 2)
  assert.equal(moveDown.changed[0].updatedAt, updatedAt)

  const moveUp = planMove(moveDown.todos, 'c', 'up', updatedAt)
  assert.deepEqual(moveUp.todos.map((item) => item.id), ['b', 'c', 'a'])
})

test('planMove returns a no-op plan at the edges', () => {
  const items = [todo('a', 0), todo('b', 1)]
  const firstUp = planMove(items, 'a', 'up', '2026-11-10T10:00:00.000Z')
  assert.deepEqual(firstUp.changed, [])
  assert.deepEqual(firstUp.todos.map((item) => item.id), ['a', 'b'])

  const lastDown = planMove(items, 'b', 'down', '2026-11-10T10:00:00.000Z')
  assert.deepEqual(lastDown.changed, [])
})

test('planMove returns null for an unknown id', () => {
  assert.equal(planMove([todo('a', 0)], 'missing', 'up', '2026-11-10T10:00:00.000Z'), null)
})

test('planMove normalizes duplicate order values', () => {
  const items = [todo('a', 0), todo('b', 0), todo('c', 0)]
  const plan = planMove(items, 'b', 'up', '2026-11-10T10:00:00.000Z')
  assert.deepEqual(plan.todos.map((item) => [item.id, item.order]), [
    ['b', 0],
    ['a', 1],
    ['c', 2],
  ])
})

test('domain spec follows storage naming rules and validates records', () => {
  assert.match(TODO_DOMAIN_SPEC.name, /^[a-z][a-z0-9_]*$/)
  assert.match(Object.keys(TODO_DOMAIN_SPEC.tables)[0], /^[a-z][a-z0-9_]*$/)
  assert.equal(TODO_DOMAIN_SPEC.version, 2)
  assert.deepEqual([...TODO_DOMAIN_SPEC.compatibleVersions], [1])
  assert.equal(TODO_DOMAIN_SPEC.layout, 'single')

  const recordSchema = TODO_DOMAIN_SPEC.tables.todos.valueSchema
  const valid = todo('abc', 0)
  assert.equal(recordSchema.parse(valid).title, 'Task abc')

  assert.throws(() => recordSchema.parse({ ...valid, title: '' }))
  assert.throws(() => recordSchema.parse({ ...valid, status: 'done' }))
  assert.throws(() => recordSchema.parse({ ...valid, order: 1.5 }))

  const globalSchema = TODO_DOMAIN_SPEC.global.schema
  assert.deepEqual(globalSchema.parse({ todos: [valid], migrated: true }).todos, [valid])
  assert.throws(() => globalSchema.parse({ todos: [], migrated: 'yes' }))
  assert.throws(() => globalSchema.parse(null))
})
