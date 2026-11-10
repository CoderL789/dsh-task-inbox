import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DomainTodoRepository,
  TodoStorageDefiniteError,
  TodoStorageUncertainError,
  classifyStorageWriteError,
  migrateLegacyTodos,
  sameTodoList,
} from '../lib/host/store.js'

function todo(id, order, overrides = {}) {
  return {
    id,
    title: `Task ${id}`,
    description: '',
    status: 'todo',
    createdAt: '2026-11-10T09:00:00.000Z',
    updatedAt: '2026-11-10T09:00:00.000Z',
    order,
    ...overrides,
  }
}

function makeDomain({ state, legacy = [], failWrite = false, failDeleteMany = false } = {}) {
  let globalState = state ?? { todos: [], migrated: false }
  const rows = new Map(legacy.map((record) => [record.id, record]))
  const calls = { writes: [], deletes: [] }
  const warnings = []
  const domain = {
    global: {
      get: () => globalState,
      set: async (value) => {
        if (failWrite) throw new Error('global write failed')
        calls.writes.push(value)
        globalState = value
      },
    },
    table: () => ({
      entries: () => rows.entries(),
      deleteMany: async (keys) => {
        calls.deletes.push([...keys])
        if (failDeleteMany) throw new Error('batch delete failed')
        let deleted = 0
        for (const key of keys) if (rows.delete(key)) deleted += 1
        return deleted
      },
    }),
    close: async () => {},
  }
  return {
    domain,
    calls,
    rows,
    warnings,
    getState: () => globalState,
    logger: { warn: (message) => warnings.push(message) },
  }
}

test('fresh install performs no migration write and creates no file', async () => {
  const { domain, calls, getState } = makeDomain()
  await migrateLegacyTodos(domain, { warn: () => {} })
  assert.equal(calls.writes.length, 0)
  assert.equal(calls.deletes.length, 0)
  assert.deepEqual(getState(), { todos: [], migrated: false })
})

test('v1 table rows migrate into the v2 global list in one atomic write', async () => {
  const second = todo('second', 1, { title: 'Second', createdAt: '2026-11-10T10:00:00.000Z' })
  const first = todo('first', 0, {
    title: 'First',
    description: 'kept',
    createdAt: '2026-11-10T08:00:00.000Z',
  })
  const { domain, calls, rows, getState } = makeDomain({ legacy: [second, first] })

  await migrateLegacyTodos(domain, { warn: () => {} })

  assert.equal(calls.writes.length, 1)
  const written = calls.writes[0]
  assert.equal(written.migrated, true)
  assert.deepEqual(written.todos.map((record) => record.id), ['first', 'second'])
  assert.deepEqual(written.todos.map((record) => record.order), [0, 1])
  // Content and timestamps are preserved by the migration.
  assert.equal(written.todos[0].title, 'First')
  assert.equal(written.todos[0].description, 'kept')
  assert.equal(written.todos[0].createdAt, first.createdAt)
  assert.deepEqual(calls.deletes, [['second', 'first']])
  assert.equal(rows.size, 0)
  assert.equal(getState().migrated, true)
})

test('stale legacy rows are cleaned up when the state is already migrated', async () => {
  const state = { todos: [todo('live', 0)], migrated: true }
  const { domain, calls, rows } = makeDomain({
    state,
    legacy: [todo('stale', 0)],
  })

  await migrateLegacyTodos(domain, { warn: () => {} })

  assert.equal(calls.writes.length, 0)
  assert.deepEqual(calls.deletes, [['stale']])
  assert.equal(rows.size, 0)
})

test('migration is idempotent and does nothing on a second run', async () => {
  const { domain, calls, logger } = makeDomain({ legacy: [todo('one', 0)] })
  await migrateLegacyTodos(domain, logger)
  const writesAfterFirst = calls.writes.length
  const deletesAfterFirst = calls.deletes.length

  await migrateLegacyTodos(domain, logger)

  assert.equal(calls.writes.length, writesAfterFirst)
  assert.equal(calls.deletes.length, deletesAfterFirst)
})

test('legacy cleanup failure is logged but does not fail the migration', async () => {
  const { domain, calls, rows, warnings, getState } = makeDomain({
    legacy: [todo('one', 0)],
    failDeleteMany: true,
  })

  await migrateLegacyTodos(domain, { warn: (message) => warnings.push(message) })

  assert.equal(calls.writes.length, 1)
  assert.equal(getState().migrated, true)
  assert.equal(rows.size, 1)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /legacy v1 todo rows could not be removed/)
})

test('a failed migration write rejects and leaves old data untouched', async () => {
  const rows = [todo('one', 0), todo('two', 1)]
  const { domain, calls, getState } = makeDomain({ legacy: rows, failWrite: true })

  await assert.rejects(migrateLegacyTodos(domain, { warn: () => {} }), /global write failed/)

  assert.equal(calls.writes.length, 0)
  assert.deepEqual(getState(), { todos: [], migrated: false })
})

test('DomainTodoRepository reads copies and writes the complete migrated state', async () => {
  const { domain, getState } = makeDomain()
  const repository = new DomainTodoRepository(domain)

  await repository.write([todo('one', 0), todo('two', 1)])
  const read = repository.read()
  assert.deepEqual(read.map((record) => record.id), ['one', 'two'])
  assert.deepEqual(getState(), { todos: read, migrated: true })

  read.length = 0
  assert.equal(repository.read().length, 2)
})

// ---------------------------------------------------------------------------
// Durable-outcome handling (review round 2)
// ---------------------------------------------------------------------------

function memoryDomain({ state, onSet, close = async () => {} }) {
  let current = state
  return {
    global: {
      get: () => current,
      set: async (value) => {
        if (onSet !== undefined) await onSet(value)
        current = value
      },
    },
    table: () => ({
      entries: () => [][Symbol.iterator](),
      deleteMany: async () => 0,
    }),
    close,
  }
}

test('classifyStorageWriteError separates definite and indeterminate outcomes', () => {
  assert.equal(classifyStorageWriteError(new TypeError('serialize failed')), 'definite')
  assert.equal(
    classifyStorageWriteError(Object.assign(new Error('closed'), { name: 'StorageError', code: 'closed' })),
    'definite',
  )
  assert.equal(
    classifyStorageWriteError(Object.assign(new Error('unknown'), { name: 'StorageError', code: 'unknown-state' })),
    'indeterminate',
  )
  assert.equal(
    classifyStorageWriteError(Object.assign(new Error('io'), { code: 'EIO' })),
    'indeterminate',
  )
  assert.equal(classifyStorageWriteError(new Error('plain')), 'indeterminate')
})

test('a definite pre-commit failure keeps the repository usable without reopening', async () => {
  let failNext = true
  const domain = memoryDomain({
    state: { todos: [], migrated: true },
    onSet: async () => {
      if (failNext) {
        failNext = false
        throw new TypeError('serialization failed')
      }
    },
  })
  let reopenCalls = 0
  const repository = new DomainTodoRepository(domain, async () => {
    reopenCalls += 1
    throw new Error('should not reopen')
  })

  await assert.rejects(repository.write([todo('a', 0)]), TodoStorageDefiniteError)
  assert.equal(reopenCalls, 0)
  assert.equal(repository.read().length, 0)

  await repository.write([todo('a', 0)])
  assert.deepEqual(repository.read().map((record) => record.id), ['a'])
})

test('unknown-state outcome that actually committed is confirmed by reopening disk', async () => {
  const attempted = [todo('a', 0)]
  let durable = { todos: [], migrated: true }
  const original = {
    global: {
      get: () => durable,
      set: async (value) => {
        durable = value // file replaced, then the API reports an error
        const error = Object.assign(new Error('unit state unknown'), {
          name: 'StorageError',
          code: 'unknown-state',
        })
        throw error
      },
    },
    table: () => ({ entries: () => [][Symbol.iterator](), deleteMany: async () => 0 }),
    close: async () => {},
  }
  let reopenCalls = 0
  const repository = new DomainTodoRepository(original, async () => {
    reopenCalls += 1
    return memoryDomain({ state: durable })
  })

  await repository.write(attempted)
  assert.equal(reopenCalls, 1)
  assert.deepEqual(repository.read().map((record) => record.id), ['a'])
  assert.equal(sameTodoList(repository.read(), attempted), true)
})

test('raw filesystem error not committed becomes a definite failure after reopening', async () => {
  const durable = { todos: [], migrated: true }
  const original = {
    global: {
      get: () => durable,
      set: async () => {
        throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' })
      },
    },
    table: () => ({ entries: () => [][Symbol.iterator](), deleteMany: async () => 0 }),
    close: async () => {},
  }
  const repository = new DomainTodoRepository(original, async () =>
    memoryDomain({ state: durable }),
  )

  await assert.rejects(repository.write([todo('a', 0)]), TodoStorageDefiniteError)
  assert.equal(repository.read().length, 0)

  // The reopened domain is usable, so later operations can continue.
  await repository.write([todo('b', 0)])
  assert.deepEqual(repository.read().map((record) => record.id), ['b'])
})

test('failed recovery poisons the repository: later reads and writes report uncertain', async () => {
  const domain = memoryDomain({
    state: { todos: [], migrated: true },
    onSet: async () => {
      throw Object.assign(new Error('EIO'), { code: 'EIO' })
    },
  })
  const repository = new DomainTodoRepository(domain, async () => {
    throw new Error('reopen failed: malformed medium')
  })

  await assert.rejects(repository.write([todo('a', 0)]), TodoStorageUncertainError)
  await assert.rejects(async () => repository.read(), TodoStorageUncertainError)
  await assert.rejects(repository.write([todo('b', 0)]), TodoStorageUncertainError)
})

test('recovery finding a third state poisons the repository as uncertain', async () => {
  const domain = memoryDomain({
    state: { todos: [todo('old', 0)], migrated: true },
    onSet: async () => {
      throw Object.assign(new Error('EIO'), { code: 'EIO' })
    },
  })
  const repository = new DomainTodoRepository(domain, async () =>
    memoryDomain({ state: { todos: [todo('foreign', 0)], migrated: true } }),
  )

  await assert.rejects(repository.write([todo('new', 0)]), TodoStorageUncertainError)
  await assert.rejects(async () => repository.read(), TodoStorageUncertainError)
})
