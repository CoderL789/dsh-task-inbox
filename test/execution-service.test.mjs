import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ExecutionService,
  ExecutionServiceError,
  buildPromptSnapshot,
} from '../lib/host/execution-service.js'

function todo(overrides = {}) {
  return {
    id: 'todo-1',
    title: 'Ship it',
    description: 'with details',
    status: 'todo',
    createdAt: '2026-11-10T09:00:00.000Z',
    updatedAt: '2026-11-10T09:00:00.000Z',
    order: 0,
    ...overrides,
  }
}

function workspace(overrides = {}) {
  return {
    id: 'ws-a',
    title: 'Workspace A',
    path: '/work/a',
    sessionIds: ['session-src', 'session-blank', 'session-unknown'],
    status: async () => 'ok',
    ...overrides,
  }
}

function persistedSession(id, overrides = {}) {
  return {
    header: {
      id,
      cwd: '/work/a',
      createdAt: 1_700_000_100_000,
      ...overrides.header,
    },
    eventCount: overrides.eventCount,
  }
}

function fakePersistence({ snapshots = [], eventsById = {}, failOpen = new Set() } = {}) {
  return {
    list: async () => snapshots,
    open: async (id, access) => {
      assert.equal(access, 'read')
      if (failOpen.has(id)) throw new Error(`open ${id} failed`)
      const events = eventsById[id] ?? []
      return {
        read: async (offset = 0, length = events.length) => ({
          events: events.slice(offset, offset + length),
        }),
        close: async () => {},
      }
    },
  }
}

class FakeStore {
  constructor(records = []) {
    this.records = records
    this.failWrites = false
    this.failReads = false
  }

  read() {
    if (this.failReads) throw new Error('read failed')
    return [...this.records]
  }

  async mutate(recipe) {
    if (this.failWrites) throw new Error('write failed')
    const { next, result } = recipe(this.read())
    this.records = next
    return result
  }
}

function makeHarness(options = {}) {
  const snapshots = options.snapshots ?? [
    persistedSession('session-src', { eventCount: 3 }),
    persistedSession('session-blank', { eventCount: 0 }),
    persistedSession('session-unknown', { eventCount: undefined }),
    persistedSession('session-new', { eventCount: 0 }),
    persistedSession('session-child', { eventCount: 2 }),
  ]
  const eventsById = {
    'session-src': [{ type: 'turn/start' }],
    'session-child': [{ type: 'turn/start' }],
    ...options.eventsById,
  }
  const persistence =
    options.persistence ??
    fakePersistence({
      snapshots,
      eventsById,
      failOpen: new Set(['session-unknown']),
    })
  const store = new FakeStore(options.records ?? [])
  let counter = 0
  const service = new ExecutionService({
    store,
    todoLookup: (id) => (options.todos ?? [todo()]).find((entry) => entry.id === id),
    workspaceRegistry: options.workspaceRegistry ?? {
      list: () => [workspace()],
      get: (id) => (id === 'ws-a' ? workspace() : undefined),
    },
    sessionPersistence: persistence,
    sessions: { get: () => undefined },
    sessionTitle: { get: () => undefined },
    clock: {
      isoNow: () => options.now ?? '2026-11-10T10:00:00.000Z',
      epochMs: () => options.nowMs ?? 1_700_000_200_000,
    },
    ids: {
      executionId: () => `exec-${++counter}`,
      requestId: () => `req-${counter}`,
    },
  })
  return { service, store, snapshots }
}

function newIntent(overrides = {}) {
  return {
    clientRequestId: 'client-1',
    todoId: 'todo-1',
    strategy: 'new',
    workspaceId: 'ws-a',
    ...overrides,
  }
}

test('createIntent snapshots the Todo and persists a prepared execution', async () => {
  const { service, store } = makeHarness()
  const record = await service.createIntent(newIntent())

  assert.equal(record.status, 'prepared')
  assert.equal(record.executionId, 'exec-1')
  assert.equal(record.requestId, 'req-1')
  assert.equal(record.todoTitle, 'Ship it')
  assert.equal(record.promptText, 'Ship it\n\nwith details')
  assert.equal(record.workspacePath, '/work/a')
  assert.equal(store.records.length, 1)
})

test('createIntent is idempotent by clientRequestId and rejects changed parameters', async () => {
  const { service, store } = makeHarness()
  const first = await service.createIntent(newIntent())
  const again = await service.createIntent(newIntent())
  assert.equal(again.executionId, first.executionId)
  assert.equal(store.records.length, 1)

  await assert.rejects(
    service.createIntent(newIntent({ strategy: 'reuse', sourceSessionId: 'session-src' })),
    (error) => error.code === 'execution_conflict',
  )
})

test('createIntent re-validates Todo, Workspace and source Session', async () => {
  const { service } = makeHarness()
  await assert.rejects(service.createIntent(newIntent({ todoId: 'missing' })), (error) => error.code === 'todo_not_found')
  await assert.rejects(service.createIntent(newIntent({ workspaceId: 'missing' })), (error) => error.code === 'workspace_not_found')

  const unavailable = makeHarness({
    workspaceRegistry: {
      list: () => [workspace()],
      get: () => workspace({ status: async () => 'missing-dir' }),
    },
  })
  await assert.rejects(
    unavailable.service.createIntent(newIntent({ workspaceId: 'ws-a' })),
    (error) => error.code === 'workspace_unavailable',
  )

  await assert.rejects(
    service.createIntent(newIntent({ strategy: 'reuse', sourceSessionId: 'session-blank' })),
    (error) => error.code === 'source_session_blank',
  )
  await assert.rejects(
    service.createIntent(newIntent({ strategy: 'reuse', sourceSessionId: 'session-unknown' })),
    (error) => error.code === 'source_session_state_unknown',
  )
  await assert.rejects(
    service.createIntent(newIntent({ strategy: 'reuse' })),
    (error) => error.code === 'source_session_required',
  )
})

test('markSessionReady persists the actual Session id and validates it', async () => {
  const { service } = makeHarness()
  const record = await service.createIntent(newIntent())
  const ready = await service.markSessionReady(record.executionId, 'session-new')
  assert.equal(ready.status, 'session_ready')
  assert.equal(ready.targetSessionId, 'session-new')

  // Idempotent repeated report.
  const again = await service.markSessionReady(record.executionId, 'session-new')
  assert.equal(again.targetSessionId, 'session-new')

  const usedTarget = makeHarness({
    snapshots: [
      persistedSession('session-src', { eventCount: 3 }),
      persistedSession('session-used', { eventCount: 3 }),
    ],
    eventsById: { 'session-src': [{ type: 'turn/start' }], 'session-used': [{ type: 'turn/start' }] },
  })
  const usedRecord = await usedTarget.service.createIntent(newIntent({ clientRequestId: 'client-2' }))
  await assert.rejects(
    usedTarget.service.markSessionReady(usedRecord.executionId, 'session-used'),
    (error) => error.code === 'target_session_not_blank',
  )
})

test('reuse must target its source; fork must target a different child', async () => {
  const { service } = makeHarness()
  const reuse = await service.createIntent(newIntent({ clientRequestId: 'c-reuse', strategy: 'reuse', sourceSessionId: 'session-src' }))
  await assert.rejects(
    service.markSessionReady(reuse.executionId, 'session-blank'),
    (error) => error.code === 'target_session_wrong_workspace',
  )
  const ready = await service.markSessionReady(reuse.executionId, 'session-src')
  assert.equal(ready.status, 'session_ready')

  const fork = await service.createIntent(newIntent({ clientRequestId: 'c-fork', strategy: 'fork', sourceSessionId: 'session-src' }))
  await assert.rejects(
    service.markSessionReady(fork.executionId, 'session-src'),
    (error) => error.code === 'target_session_already_bound',
  )
  const child = await service.markSessionReady(fork.executionId, 'session-child')
  assert.equal(child.status, 'session_ready')
})

test('dispatching can start before create/fork and is idempotent', async () => {
  const { service, store } = makeHarness()
  const record = await service.createIntent(newIntent())

  // The Client records "dispatching" before the non-idempotent create/fork.
  const dispatching = await service.beginDispatching(record.executionId)
  assert.equal(dispatching.status, 'dispatching')
  assert.equal(dispatching.targetSessionId, undefined)

  // A retried intent returns the same non-prepared record, so the Client can
  // never create a second Session for the same execution.
  const retried = await service.createIntent(newIntent())
  assert.equal(retried.executionId, record.executionId)
  assert.equal(retried.status, 'dispatching')
  assert.equal(store.records.length, 1)

  await service.markSessionReady(record.executionId, 'session-new')
  const again = await service.beginDispatching(record.executionId)
  assert.equal(again.status, 'dispatching')
})

test('interrupted create/fork becomes unknown instead of being retried', async () => {
  const { service, store } = makeHarness()
  const record = await service.createIntent(newIntent())
  await service.beginDispatching(record.executionId)
  const status = await service.getStatus(record.executionId)
  assert.equal(status.status, 'unknown')
  assert.equal(status.errorCode, 'dispatch_interrupted')
  assert.equal(store.records[0].status, 'unknown')
  assert.equal(store.records[0].targetSessionId, undefined)
})

test('prompt acceptance is verified from the Session log requestId, not the Client report', async () => {
  const verification = {
    snapshots: [
      persistedSession('session-src', { eventCount: 3 }),
      persistedSession('session-new', { eventCount: 0 }),
    ],
    eventsById: {
      'session-src': [{ type: 'turn/start' }],
      'session-new': [
        { type: 'user/message', data: { role: 'user', source: { kind: 'user', rpcId: 'req-1' } } },
        { type: 'turn/start' },
      ],
    },
  }
  const verified = makeHarness(verification)
  const record = await verified.service.createIntent(newIntent())
  await verified.service.markSessionReady(record.executionId, 'session-new')
  await verified.service.beginDispatching(record.executionId)
  const accepted = await verified.service.reportPromptResult(record.executionId, { outcome: 'accepted' })
  assert.equal(accepted.status, 'accepted')

  // Client claims failure but the log proves acceptance -> accepted.
  const falseNegative = await verified.service.reportPromptResult(record.executionId, {
    outcome: 'failed',
    errorCode: 'client/error',
  })
  assert.equal(falseNegative.status, 'accepted')

  // Client claims acceptance but the log has no request id -> Host keeps it
  // pending (dispatching), never trusts the report alone.
  const unverified = makeHarness({
    snapshots: [
      persistedSession('session-src', { eventCount: 3 }),
      persistedSession('session-new', { eventCount: 0 }),
    ],
    eventsById: {
      'session-src': [{ type: 'turn/start' }],
      'session-new': [{ type: 'user/message', data: { source: { rpcId: 'other' } } }],
    },
  })
  const pending = await unverified.service.createIntent(newIntent())
  await unverified.service.markSessionReady(pending.executionId, 'session-new')
  await unverified.service.beginDispatching(pending.executionId)
  const claimed = await unverified.service.reportPromptResult(pending.executionId, { outcome: 'accepted' })
  assert.equal(claimed.status, 'dispatching')
})

test('getStatus can promote dispatching to accepted once the log shows the request id', async () => {
  const eventsById = {
    'session-src': [{ type: 'turn/start' }],
    'session-new': [],
  }
  const { service, store } = makeHarness({
    snapshots: [
      persistedSession('session-src', { eventCount: 3 }),
      persistedSession('session-new', { eventCount: 0 }),
    ],
    eventsById,
  })
  const record = await service.createIntent(newIntent())
  await service.markSessionReady(record.executionId, 'session-new')
  await service.beginDispatching(record.executionId)
  const pending = await service.getStatus(record.executionId)
  assert.equal(pending.status, 'dispatching')

  eventsById['session-new'].push({
    type: 'user/message',
    data: { source: { rpcId: record.requestId } },
  })
  const accepted = await service.getStatus(record.executionId)
  assert.equal(accepted.status, 'accepted')
  assert.equal(store.records[0].status, 'accepted')
})

test('unknown outcomes list only plausible candidates and require explicit bind', async () => {
  const snapshots = [
    persistedSession('session-src', { eventCount: 3 }),
    persistedSession('session-old', { header: { createdAt: 1_700_000_000_000 }, eventCount: 2 }),
    persistedSession('session-candidate', {
      header: { createdAt: 1_700_000_300_000 },
      eventCount: 1,
    }),
    persistedSession('session-subagent', {
      header: { createdAt: 1_700_000_300_000, origin: 'subagent' },
      eventCount: 1,
    }),
  ]
  const { service, store } = makeHarness({
    snapshots,
    eventsById: {
      'session-src': [{ type: 'turn/start' }],
      'session-candidate': [{ type: 'turn/start' }],
      'session-old': [{ type: 'turn/start' }],
      'session-subagent': [{ type: 'turn/start' }],
    },
  })
  const record = await service.createIntent(newIntent({ strategy: 'fork', sourceSessionId: 'session-src' }))
  await service.markUnknown(record.executionId, 'fork/ambiguous')

  const candidates = await service.candidates(record.executionId)
  assert.deepEqual(candidates.map((entry) => entry.sessionId), ['session-candidate'])
  assert.equal(candidates[0].createdAt, 1_700_000_300_000)

  await assert.rejects(
    service.bindCandidate(record.executionId, 'session-old'),
    (error) => error.code === 'candidate_not_found',
  )
  const bound = await service.bindCandidate(record.executionId, 'session-candidate')
  assert.equal(bound.status, 'session_ready')
  assert.equal(bound.targetSessionId, 'session-candidate')
  assert.equal(store.records[0].status, 'session_ready')
})

test('storage failures are surfaced and ambiguous outcomes are not silently retried', async () => {
  const { service, store } = makeHarness()
  store.failWrites = true
  await assert.rejects(service.createIntent(newIntent()), (error) => {
    assert.equal(error instanceof ExecutionServiceError, true)
    assert.equal(error.code, 'storage_failed')
    return true
  })
  store.failWrites = false
  const record = await service.createIntent(newIntent())
  await service.markSessionReady(record.executionId, 'session-new')
  const unknown = await service.markUnknown(record.executionId, 'create/timeout')
  assert.equal(unknown.status, 'unknown')
  assert.equal(store.records[0].status, 'unknown')
})

test('buildPromptSnapshot keeps an immutable title+description snapshot', () => {
  assert.equal(buildPromptSnapshot({ title: 'A', description: '' }), 'A')
  assert.equal(buildPromptSnapshot({ title: 'A', description: 'B' }), 'A\n\nB')
})
