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
    this.tail = Promise.resolve()
  }

  read() {
    if (this.failReads) throw new Error('read failed')
    return [...this.records]
  }

  async mutate(recipe) {
    const run = async () => {
      if (this.failWrites) throw new Error('write failed')
      const { next, result } = recipe(this.read())
      this.records = next
      return result
    }
    const pending = this.tail.then(run, run)
    this.tail = pending.then(
      () => undefined,
      () => undefined,
    )
    return pending
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
  let nowMs = options.nowMs ?? 1_700_000_050_000
  let nowIso = new Date(nowMs).toISOString()
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
      isoNow: () => nowIso,
      epochMs: () => nowMs,
    },
    ids: {
      executionId: () => `exec-${++counter}`,
      requestId: () => `req-${counter}`,
    },
  })
  const advance = (ms) => {
    nowMs += ms
    nowIso = new Date(nowMs).toISOString()
  }
  return {
    service,
    store,
    snapshots,
    eventsById,
    persistence,
    advance,
    nowMs: () => nowMs,
  }
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
  await service.abandonExecution(reuse.executionId)

  const fork = await service.createIntent(newIntent({ clientRequestId: 'c-fork', strategy: 'fork', sourceSessionId: 'session-src' }))
  await assert.rejects(
    service.markSessionReady(fork.executionId, 'session-src'),
    (error) => error.code === 'target_session_already_bound',
  )
  const child = await service.markSessionReady(fork.executionId, 'session-child')
  assert.equal(child.status, 'session_ready')
})

test('acquire starts dispatching and legacy dispatching cannot bypass it', async () => {
  const { service, store } = makeHarness()
  const record = await service.createIntent(newIntent())

  // The old interface must not let a legacy Client start create/fork without
  // the Host-issued execution right.
  await assert.rejects(
    service.beginDispatching(record.executionId),
    (error) => error.code === 'invalid_transition',
  )
  assert.equal(store.records[0].status, 'prepared')

  const acquisition = await service.acquireExecution(record.executionId)
  assert.equal(acquisition.acquired, true)
  assert.equal(store.records[0].status, 'dispatching')

  // A retried intent returns the same non-prepared record.
  const retried = await service.createIntent(newIntent())
  assert.equal(retried.executionId, record.executionId)
  assert.equal(retried.status, 'dispatching')
  assert.equal(store.records.length, 1)

  await service.markSessionReady(record.executionId, 'session-new')
  const promptPhase = await service.beginDispatching(record.executionId)
  assert.equal(promptPhase.status, 'dispatching')
})

test('interrupted create/fork becomes unknown instead of being retried', async () => {
  const { service, store, advance } = makeHarness()
  const record = await service.createIntent(newIntent())
  await service.acquireExecution(record.executionId)

  // Another window polling immediately must not mark in-flight work unknown.
  const immediate = await service.getStatus(record.executionId)
  assert.equal(immediate.status, 'dispatching')

  advance(121_000)
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

// ---------------------------------------------------------------------------
// Concurrency, duplicate protection and recovery (Task 03B review round 1)
// ---------------------------------------------------------------------------

test('a Todo with an unresolved execution cannot start another one', async () => {
  const { service, store } = makeHarness()
  const first = await service.createIntent(newIntent())
  await assert.rejects(
    service.createIntent(newIntent({ clientRequestId: 'client-2' })),
    (error) => error.code === 'execution_unresolved',
  )
  assert.equal(store.records.length, 1)

  // Explicit abandon resolves the duplicate guard.
  const abandoned = await service.abandonExecution(first.executionId)
  assert.equal(abandoned.status, 'failed')
  assert.equal(abandoned.errorCode, 'user_abandoned')
  const second = await service.createIntent(newIntent({ clientRequestId: 'client-2' }))
  assert.equal(second.status, 'prepared')
  assert.equal(store.records.length, 2)
})

test('concurrent intents for the same Todo create exactly one execution', async () => {
  const { service, store } = makeHarness()
  const outcomes = await Promise.allSettled([
    service.createIntent(newIntent({ clientRequestId: 'client-a' })),
    service.createIntent(newIntent({ clientRequestId: 'client-b' })),
  ])
  const fulfilled = outcomes.filter((entry) => entry.status === 'fulfilled')
  const rejected = outcomes.filter((entry) => entry.status === 'rejected')
  assert.equal(fulfilled.length, 1)
  assert.equal(rejected.length, 1)
  assert.equal(rejected[0].reason.code, 'execution_unresolved')
  assert.equal(store.records.length, 1)
})

test('accepted cannot be overwritten by late failed/unknown callbacks', async () => {
  const { service, store } = makeHarness({
    snapshots: [
      persistedSession('session-src', { eventCount: 3 }),
      persistedSession('session-new', { eventCount: 0 }),
    ],
    eventsById: {
      'session-src': [{ type: 'turn/start' }],
      'session-new': [{ type: 'user/message', data: { source: { rpcId: 'req-1' } } }],
    },
  })
  const record = await service.createIntent(newIntent())
  await service.markSessionReady(record.executionId, 'session-new')
  await service.beginDispatching(record.executionId)

  const accepted = await service.reportPromptResult(record.executionId, { outcome: 'accepted' })
  assert.equal(accepted.status, 'accepted')
  const lateFailed = await service.markFailed(record.executionId, 'late/failed')
  assert.equal(lateFailed.status, 'accepted')
  assert.equal(store.records[0].status, 'accepted')

  const lateUnknown = await service.markUnknown(record.executionId, 'late/unknown')
  assert.equal(lateUnknown.status, 'accepted')
  await assert.rejects(
    service.abandonExecution(record.executionId),
    (error) => error.code === 'abandon_not_allowed',
  )
})

test('a bound target Session cannot be replaced by another Session', async () => {
  const { service } = makeHarness({
    snapshots: [
      persistedSession('session-src', { eventCount: 3 }),
      persistedSession('session-new', { eventCount: 0 }),
      persistedSession('session-new2', { eventCount: 0 }),
    ],
    eventsById: { 'session-src': [{ type: 'turn/start' }] },
  })
  const record = await service.createIntent(newIntent())
  const ready = await service.markSessionReady(record.executionId, 'session-new')
  assert.equal(ready.targetSessionId, 'session-new')
  await assert.rejects(
    service.markSessionReady(record.executionId, 'session-new2'),
    (error) => error.code === 'target_session_already_bound',
  )
  const final = await service.getStatus(record.executionId)
  assert.equal(final.targetSessionId, 'session-new')
})

test('a new execution cannot bind a Session owned by another execution', async () => {
  const { service } = makeHarness({
    snapshots: [
      persistedSession('session-src', { eventCount: 3 }),
      persistedSession('session-shared', { eventCount: 0 }),
    ],
    eventsById: {
      'session-src': [{ type: 'turn/start' }],
      'session-shared': [{ type: 'user/message', data: { source: { rpcId: 'req-1' } } }],
    },
  })
  const first = await service.createIntent(newIntent({ clientRequestId: 'c-1' }))
  await service.markSessionReady(first.executionId, 'session-shared')
  await service.beginDispatching(first.executionId)
  const accepted = await service.reportPromptResult(first.executionId, { outcome: 'accepted' })
  assert.equal(accepted.status, 'accepted')

  const second = await service.createIntent(newIntent({ clientRequestId: 'c-2' }))
  await assert.rejects(
    service.markSessionReady(second.executionId, 'session-shared'),
    (error) => error.code === 'target_session_already_bound',
  )
})

test('new/fork targets must not predate the intent', async () => {
  const { service } = makeHarness({
    snapshots: [
      persistedSession('session-src', { eventCount: 3 }),
      persistedSession('session-stale', {
        header: { createdAt: 1_700_000_000_000 },
        eventCount: 0,
      }),
    ],
    eventsById: { 'session-src': [{ type: 'turn/start' }] },
  })
  const record = await service.createIntent(newIntent())
  await assert.rejects(
    service.markSessionReady(record.executionId, 'session-stale'),
    (error) => error.code === 'target_session_before_intent',
  )
})

test('manual candidate binding revalidates the original strategy', async () => {
  const { service } = makeHarness()
  const record = await service.createIntent(newIntent())
  await service.markUnknown(record.executionId, 'create/ambiguous')

  // A non-blank Session cannot satisfy the new-session strategy.
  await assert.rejects(
    service.bindCandidate(record.executionId, 'session-src'),
    (error) => error.code === 'candidate_not_found',
  )
  const bound = await service.bindCandidate(record.executionId, 'session-blank')
  assert.equal(bound.status, 'session_ready')
  assert.equal(bound.bindingSource, 'manual')
})

test('getStatus can recover an unknown execution to accepted from the log', async () => {
  const eventsById = {
    'session-src': [{ type: 'turn/start' }],
    'session-new': [],
  }
  const { service } = makeHarness({
    snapshots: [
      persistedSession('session-src', { eventCount: 3 }),
      persistedSession('session-new', { eventCount: 0 }),
    ],
    eventsById,
  })
  const record = await service.createIntent(newIntent())
  await service.markSessionReady(record.executionId, 'session-new')
  await service.markUnknown(record.executionId, 'prompt/timeout')

  eventsById['session-new'].push({ type: 'user/message', data: { source: { rpcId: record.requestId } } })
  const status = await service.getStatus(record.executionId)
  assert.equal(status.status, 'accepted')
})

test('concurrent target bindings leave exactly one target and never overwrite', async () => {
  const { service, store } = makeHarness({
    snapshots: [
      persistedSession('session-src', { eventCount: 3 }),
      persistedSession('session-new', { eventCount: 0 }),
      persistedSession('session-new2', { eventCount: 0 }),
    ],
    eventsById: { 'session-src': [{ type: 'turn/start' }] },
  })
  const record = await service.createIntent(newIntent())
  const outcomes = await Promise.allSettled([
    service.markSessionReady(record.executionId, 'session-new'),
    service.markSessionReady(record.executionId, 'session-new2'),
  ])
  assert.equal(outcomes.filter((entry) => entry.status === 'fulfilled').length, 1)
  assert.equal(outcomes.filter((entry) => entry.status === 'rejected').length, 1)
  assert.equal(store.records[0].targetSessionId !== undefined, true)
})

test('accepted remains the final state under concurrent late callbacks', async () => {
  const { service, store } = makeHarness({
    snapshots: [
      persistedSession('session-src', { eventCount: 3 }),
      persistedSession('session-new', { eventCount: 0 }),
    ],
    eventsById: {
      'session-src': [{ type: 'turn/start' }],
      'session-new': [{ type: 'user/message', data: { source: { rpcId: 'req-1' } } }],
    },
  })
  const record = await service.createIntent(newIntent())
  await service.markSessionReady(record.executionId, 'session-new')
  await service.beginDispatching(record.executionId)

  await Promise.allSettled([
    service.reportPromptResult(record.executionId, { outcome: 'accepted' }),
    service.markFailed(record.executionId, 'late/failed'),
  ])
  assert.equal(store.records[0].status, 'accepted')
})

test('abandon is rejected while a dispatch is in flight', async () => {
  const { service } = makeHarness()
  const record = await service.createIntent(newIntent())
  await service.acquireExecution(record.executionId)
  await assert.rejects(
    service.abandonExecution(record.executionId),
    (error) => error.code === 'invalid_transition',
  )
})

test('candidates are marked as manual bindings', async () => {
  const { service } = makeHarness()
  const record = await service.createIntent(newIntent())
  await service.markUnknown(record.executionId, 'create/ambiguous')
  const candidates = await service.candidates(record.executionId)
  assert.equal(candidates.length > 0, true)
  assert.equal(candidates[0].manualBinding, true)
})

// ---------------------------------------------------------------------------
// Review round 2: exclusive dispatch lease, full intent comparison, safe
// unknown Prompt retry
// ---------------------------------------------------------------------------

test('concurrent acquire yields exactly one non-idempotent execution right', async () => {
  const { service, store, advance } = makeHarness()
  const record = await service.createIntent(newIntent())

  const [first, second] = await Promise.all([
    service.acquireExecution(record.executionId),
    service.acquireExecution(record.executionId),
  ])
  assert.equal([first.acquired, second.acquired].filter(Boolean).length, 1)
  assert.equal(store.records[0].status, 'dispatching')
  assert.equal(typeof store.records[0].dispatchLeaseToken, 'string')
  assert.equal(typeof store.records[0].dispatchLeaseExpiresAt, 'string')

  // The state switch can never be acquired again, not even after timeout.
  const again = await service.acquireExecution(record.executionId)
  assert.equal(again.acquired, false)

  advance(121_000)
  const aged = await service.getStatus(record.executionId)
  assert.equal(aged.status, 'unknown')
  const afterTimeout = await service.acquireExecution(record.executionId)
  assert.equal(afterTimeout.acquired, false)
})

test('after acquisition, acquiring the same execution again is denied', async () => {
  const { service, store } = makeHarness()
  const record = await service.createIntent(newIntent())
  const first = await service.acquireExecution(record.executionId)
  assert.equal(first.acquired, true)
  const second = await service.acquireExecution(record.executionId)
  assert.equal(second.acquired, false)
  assert.equal(store.records[0].status, 'dispatching')
  assert.equal(store.records.length, 1)
})

test('same clientRequestId with different parameters is a conflict, not another execution', async () => {
  const { service, store } = makeHarness({
    todos: [todo(), todo({ id: 'todo-2', title: 'Other' })],
  })
  const outcomes = await Promise.allSettled([
    service.createIntent(newIntent({ clientRequestId: 'same-id', todoId: 'todo-1' })),
    service.createIntent(newIntent({ clientRequestId: 'same-id', todoId: 'todo-2' })),
  ])
  const fulfilled = outcomes.filter((entry) => entry.status === 'fulfilled')
  const rejected = outcomes.filter((entry) => entry.status === 'rejected')
  assert.equal(fulfilled.length, 1)
  assert.equal(rejected.length, 1)
  assert.equal(rejected[0].reason.code, 'execution_conflict')
  assert.equal(store.records.length, 1)
  assert.equal(store.records[0].todoId, fulfilled[0].value.todoId)

  // Same id/same parameters is still idempotent.
  const same = await service.createIntent(
    newIntent({
      clientRequestId: 'same-id',
      todoId: store.records[0].todoId,
    }),
  )
  assert.equal(same.executionId, store.records[0].executionId)

  // Different source Session / strategy must also conflict.
  await assert.rejects(
    service.createIntent(
      newIntent({
        clientRequestId: 'same-id',
        todoId: store.records[0].todoId,
        strategy: 'reuse',
        sourceSessionId: 'session-src',
      }),
    ),
    (error) => error.code === 'execution_conflict',
  )

  // Different Workspace must conflict before returning a record with the wrong
  // workspace.
  await assert.rejects(
    service.createIntent(
      newIntent({
        clientRequestId: 'same-id',
        todoId: store.records[0].todoId,
        workspaceId: 'ws-other',
      }),
    ),
    (error) => error.code === 'execution_conflict',
  )
})

test('authorizePromptRetry authorizes only one safe retry for unknown', async () => {
  const { service, store } = makeHarness({
    snapshots: [
      persistedSession('session-src', { eventCount: 3 }),
      persistedSession('session-new', { eventCount: 0 }),
    ],
    eventsById: { 'session-src': [{ type: 'turn/start' }] },
  })
  const record = await service.createIntent(newIntent())
  await service.markSessionReady(record.executionId, 'session-new')
  await service.markUnknown(record.executionId, 'prompt/timeout')

  const [first, second] = await Promise.all([
    service.authorizePromptRetry(record.executionId),
    service.authorizePromptRetry(record.executionId),
  ])
  assert.equal([first.authorized, second.authorized].filter(Boolean).length, 1)
  assert.equal(store.records[0].status, 'dispatching')
})

test('authorizePromptRetry never authorizes when the log already proves acceptance', async () => {
  const eventsById = {
    'session-src': [{ type: 'turn/start' }],
    'session-new': [{ type: 'user/message', data: { source: { rpcId: 'req-1' } } }],
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
  await service.markUnknown(record.executionId, 'prompt/timeout')

  const authorization = await service.authorizePromptRetry(record.executionId)
  assert.equal(authorization.authorized, false)
  assert.equal(authorization.execution.status, 'accepted')
  assert.equal(store.records[0].status, 'accepted')
})

// ---------------------------------------------------------------------------
// Review round 3: Session reuse, reuse recovery, legacy interface, retry safety
// ---------------------------------------------------------------------------

test('new Session accepted, then another Todo reuses the same Session', async () => {
  const snapshot = persistedSession('session-shared', { eventCount: 0 })
  const { service, snapshots, eventsById } = makeHarness({
    todos: [todo(), todo({ id: 'todo-2', title: 'Reuse task' })],
    snapshots: [
      persistedSession('session-src', { eventCount: 3 }),
      snapshot,
    ],
    eventsById: {
      'session-src': [{ type: 'turn/start' }],
      'session-shared': [],
    },
  })
  const first = await service.createIntent(newIntent({ clientRequestId: 'c1' }))
  await service.markSessionReady(first.executionId, 'session-shared')
  await service.beginDispatching(first.executionId)
  eventsById['session-shared'].push({
    type: 'user/message',
    data: { source: { rpcId: 'req-1' } },
  })
  const accepted = await service.reportPromptResult(first.executionId, { outcome: 'accepted' })
  assert.equal(accepted.status, 'accepted')

  // The Session is now non-blank and already bound to the first execution.
  snapshot.eventCount = 5
  eventsById['session-shared'].push({ type: 'turn/start' })

  const second = await service.createIntent(
    newIntent({
      clientRequestId: 'c2',
      todoId: 'todo-2',
      strategy: 'reuse',
      sourceSessionId: 'session-shared',
    }),
  )
  await service.acquireExecution(second.executionId) // no create/fork for reuse
  const bound = await service.markSessionReady(second.executionId, 'session-shared')
  assert.equal(bound.status, 'session_ready')
  assert.equal(bound.targetSessionId, 'session-shared')
  await service.beginDispatching(second.executionId)
  eventsById['session-shared'].push({
    type: 'user/message',
    data: { source: { rpcId: 'req-2' } },
  })
  const secondAccepted = await service.reportPromptResult(second.executionId, { outcome: 'accepted' })
  assert.equal(secondAccepted.status, 'accepted')
  assert.notEqual(accepted.requestId, secondAccepted.requestId)

  // Same Todo may start another independent execution after acceptance.
  const third = await service.createIntent(
    newIntent({ clientRequestId: 'c3', todoId: 'todo-1' }),
  )
  assert.equal(third.status, 'prepared')
  assert.equal(snapshots.length > 0, true)
})

test('reuse recovery binds the original source Session without create/fork', async () => {
  const { service, eventsById } = makeHarness({
    snapshots: [
      persistedSession('session-src', { eventCount: 3 }),
      persistedSession('session-other', { eventCount: 2 }),
    ],
    eventsById: { 'session-src': [{ type: 'turn/start' }] },
  })
  const record = await service.createIntent(
    newIntent({ strategy: 'reuse', sourceSessionId: 'session-src' }),
  )
  await service.acquireExecution(record.executionId)

  const recovery = await service.recoverReuseExecution(record.executionId)
  assert.equal(recovery.recovered, true)
  assert.equal(recovery.execution.status, 'session_ready')
  assert.equal(recovery.execution.targetSessionId, 'session-src')
  assert.equal(recovery.execution.executionId, record.executionId)
  assert.equal(recovery.execution.requestId, record.requestId)
  assert.equal(recovery.execution.promptText, record.promptText)

  // The Prompt is now sent with the same execution/request/snapshot.
  await service.beginDispatching(record.executionId)
  eventsById['session-src'].push({
    type: 'user/message',
    data: { source: { rpcId: record.requestId } },
  })
  const accepted = await service.reportPromptResult(record.executionId, { outcome: 'accepted' })
  assert.equal(accepted.status, 'accepted')
})

test('reuse recovery promotes an already accepted Prompt without re-sending', async () => {
  const recordRequest = 'req-1'
  const { service } = makeHarness({
    snapshots: [persistedSession('session-src', { eventCount: 3 })],
    eventsById: {
      'session-src': [
        { type: 'turn/start' },
        { type: 'user/message', data: { source: { rpcId: recordRequest } } },
      ],
    },
  })
  const record = await service.createIntent(
    newIntent({ strategy: 'reuse', sourceSessionId: 'session-src' }),
  )
  await service.acquireExecution(record.executionId)
  const recovery = await service.recoverReuseExecution(record.executionId)
  assert.equal(recovery.recovered, true)
  assert.equal(recovery.execution.status, 'accepted')
  assert.equal(recovery.execution.targetSessionId, 'session-src')
})

test('reuse recovery keeps unknown when the source log cannot be read', async () => {
  const failOpen = new Set()
  const persistence = fakePersistence({
    snapshots: [persistedSession('session-src', { eventCount: 3 })],
    eventsById: { 'session-src': [{ type: 'turn/start' }] },
    failOpen,
  })
  const { service } = makeHarness({ persistence })
  const record = await service.createIntent(
    newIntent({ strategy: 'reuse', sourceSessionId: 'session-src' }),
  )
  await service.acquireExecution(record.executionId)
  failOpen.add('session-src')

  const recovery = await service.recoverReuseExecution(record.executionId)
  assert.equal(recovery.recovered, false)
  assert.equal(recovery.execution.status, 'unknown')
  assert.equal(recovery.execution.errorCode, 'recovery_verification_unavailable')
})

test('authorizePromptRetry refuses to authorize when the log is unreadable', async () => {
  const failOpen = new Set()
  const persistence = fakePersistence({
    snapshots: [persistedSession('session-src', { eventCount: 3 }), persistedSession('session-new', { eventCount: 0 })],
    eventsById: { 'session-src': [{ type: 'turn/start' }] },
    failOpen,
  })
  const { service } = makeHarness({ persistence })
  const record = await service.createIntent(newIntent())
  await service.markSessionReady(record.executionId, 'session-new')
  await service.markUnknown(record.executionId, 'prompt/timeout')
  failOpen.add('session-new')

  const authorization = await service.authorizePromptRetry(record.executionId)
  assert.equal(authorization.authorized, false)
  assert.equal(authorization.execution.status, 'unknown')
  assert.equal(authorization.execution.errorCode, 'recovery_verification_unavailable')
})

test('authorizePromptRetry refuses to authorize at the scan limit', async () => {
  const manyEvents = Array.from({ length: 20_001 }, () => ({ type: 'turn/start' }))
  const { service } = makeHarness({
    snapshots: [persistedSession('session-src', { eventCount: 3 }), persistedSession('session-new', { eventCount: 0 })],
    eventsById: {
      'session-src': [{ type: 'turn/start' }],
      'session-new': manyEvents,
    },
  })
  const record = await service.createIntent(newIntent())
  await service.markSessionReady(record.executionId, 'session-new')
  await service.markUnknown(record.executionId, 'prompt/timeout')

  const authorization = await service.authorizePromptRetry(record.executionId)
  assert.equal(authorization.authorized, false)
  assert.equal(authorization.execution.status, 'unknown')
})

