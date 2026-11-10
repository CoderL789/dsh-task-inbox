import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assembleExecutionContext,
  buildExecutionContext,
  filterSessionsForWorkspace,
  isSessionSuitable,
  validateExecutionSelection,
} from '../lib/host/execution-context.js'

function workspace(overrides = {}) {
  return {
    id: 'ws-a',
    title: 'Workspace A',
    path: '/work/a',
    sessionIds: [],
    availability: 'ok',
    ...overrides,
  }
}

function snapshot(id, overrides = {}) {
  return {
    id,
    cwd: '/work/a',
    createdAt: 1_700_000_000_000,
    eventCount: 10,
    ...overrides,
  }
}

function contextOf() {
  return assembleExecutionContext({
    workspaces: [
      workspace({ sessionIds: ['session-1', 'session-blank', 'session-subagent'] }),
    ],
    snapshots: [
      snapshot('session-1'),
      snapshot('session-blank', { eventCount: 0 }),
      snapshot('session-subagent', { origin: 'subagent' }),
    ],
    liveSessionIds: ['session-1'],
    titles: new Map([['session-1', 'Existing work']]),
  })
}

test('assembleExecutionContext maps workspaces and session candidates', () => {
  const context = contextOf()
  assert.equal(context.available, true)
  assert.equal(context.workspaces.length, 1)
  assert.equal(context.workspaces[0].available, true)
  assert.deepEqual(context.workspaces[0].path, '/work/a')

  const ids = context.sessions.map((session) => session.sessionId)
  assert.deepEqual(ids.sort(), ['session-1', 'session-blank'].sort())

  const existing = context.sessions.find((session) => session.sessionId === 'session-1')
  assert.equal(existing.title, 'Existing work')
  assert.equal(existing.live, true)
  assert.equal(existing.stored, true)
  assert.equal(existing.blank, false)
  assert.equal(existing.suitableForReuse, true)
  assert.equal(existing.suitableForFork, true)
  assert.deepEqual(existing.unavailableReasons, [])
  assert.deepEqual(existing.warnings.sort(), ['archive_state_unknown', 'fork_requires_completed_turn'])

  const blank = context.sessions.find((session) => session.sessionId === 'session-blank')
  assert.equal(blank.blank, true)
  assert.equal(blank.suitableForReuse, false)
  assert.equal(blank.suitableForFork, false)
  assert.deepEqual(blank.unavailableReasons, ['blank_session'])
})

test('sessions in a workspace index but missing from storage are marked not found', () => {
  const context = assembleExecutionContext({
    workspaces: [workspace({ sessionIds: ['gone-session'] })],
    snapshots: [],
    liveSessionIds: [],
    titles: new Map(),
  })
  const missing = context.sessions[0]
  assert.equal(missing.stored, false)
  assert.equal(missing.suitableForReuse, false)
  assert.deepEqual(missing.unavailableReasons, ['session_not_found'])
})

test('subagent-origin sessions are excluded from execution candidates', () => {
  const context = assembleExecutionContext({
    workspaces: [workspace({ sessionIds: ['child'] })],
    snapshots: [snapshot('child', { origin: 'subagent' })],
    liveSessionIds: [],
    titles: new Map(),
  })
  assert.deepEqual(context.sessions, [])
})

test('workspace availability comes from the registry status', () => {
  const context = assembleExecutionContext({
    workspaces: [
      workspace({ id: 'ws-ok', sessionIds: [] }),
      workspace({ id: 'ws-bad', availability: 'missing-dir', sessionIds: [] }),
      workspace({ id: 'ws-unknown', availability: 'unknown', sessionIds: [] }),
    ],
    snapshots: [],
    liveSessionIds: [],
    titles: new Map(),
  })
  assert.deepEqual(
    context.workspaces.map((entry) => [entry.id, entry.available]),
    [
      ['ws-ok', true],
      ['ws-bad', false],
      ['ws-unknown', false],
    ],
  )
})

test('sessions are associated with exactly their workspace', () => {
  const context = assembleExecutionContext({
    workspaces: [
      workspace({ id: 'ws-a', sessionIds: ['a-1'] }),
      workspace({ id: 'ws-b', title: 'Workspace B', path: '/work/b', sessionIds: ['b-1'] }),
    ],
    snapshots: [
      snapshot('a-1', { cwd: '/work/a' }),
      snapshot('b-1', { cwd: '/work/b' }),
    ],
    liveSessionIds: [],
    titles: new Map(),
  })

  assert.deepEqual(
    filterSessionsForWorkspace(context, 'ws-a').map((session) => session.sessionId),
    ['a-1'],
  )
  assert.deepEqual(
    filterSessionsForWorkspace(context, 'ws-b').map((session) => session.sessionId),
    ['b-1'],
  )
  assert.deepEqual(filterSessionsForWorkspace(context, ''), [])
  assert.deepEqual(filterSessionsForWorkspace(context, undefined), [])
})

test('isSessionSuitable follows the strategy rules', () => {
  const context = contextOf()
  const existing = context.sessions.find((session) => session.sessionId === 'session-1')
  const blank = context.sessions.find((session) => session.sessionId === 'session-blank')
  assert.equal(isSessionSuitable(existing, 'reuse'), true)
  assert.equal(isSessionSuitable(existing, 'fork'), true)
  assert.equal(isSessionSuitable(blank, 'reuse'), false)
  assert.equal(isSessionSuitable(blank, 'fork'), false)
  assert.equal(isSessionSuitable(blank, 'new'), true)
})

test('validateExecutionSelection rejects every invalid selection shape', () => {
  const context = contextOf()
  const unavailable = { available: false, reason: 'no services', workspaces: [], sessions: [] }

  assert.deepEqual(validateExecutionSelection(unavailable, { strategy: 'new' }), {
    ok: false,
    code: 'context_unavailable',
    message: 'no services',
  })
  assert.equal(
    validateExecutionSelection(context, { strategy: 'new' }).code,
    'workspace_missing',
  )

  const missingDir = assembleExecutionContext({
    workspaces: [workspace({ id: 'ws-bad', availability: 'missing-dir' })],
    snapshots: [],
    liveSessionIds: [],
    titles: new Map(),
  })
  assert.equal(
    validateExecutionSelection(missingDir, { workspaceId: 'ws-bad', strategy: 'new' }).code,
    'workspace_unavailable',
  )

  assert.deepEqual(validateExecutionSelection(context, { workspaceId: 'ws-a', strategy: 'new' }), {
    ok: true,
  })
  assert.equal(
    validateExecutionSelection(context, { workspaceId: 'ws-a', strategy: 'reuse' }).code,
    'session_required',
  )
  assert.equal(
    validateExecutionSelection(context, {
      workspaceId: 'ws-a',
      strategy: 'reuse',
      sessionId: 'unknown',
    }).code,
    'session_not_found',
  )

  const twoWorkspaces = assembleExecutionContext({
    workspaces: [
      workspace({ id: 'ws-a', sessionIds: ['a-1'] }),
      workspace({ id: 'ws-b', title: 'Workspace B', path: '/work/b', sessionIds: ['b-1'] }),
    ],
    snapshots: [snapshot('a-1', { cwd: '/work/a' }), snapshot('b-1', { cwd: '/work/b' })],
    liveSessionIds: [],
    titles: new Map(),
  })
  assert.equal(
    validateExecutionSelection(twoWorkspaces, {
      workspaceId: 'ws-a',
      strategy: 'reuse',
      sessionId: 'b-1',
    }).code,
    'session_wrong_workspace',
  )
  assert.equal(
    validateExecutionSelection(twoWorkspaces, {
      workspaceId: 'ws-a',
      strategy: 'reuse',
      sessionId: 'a-1',
    }).ok,
    true,
  )
  assert.equal(
    validateExecutionSelection(twoWorkspaces, {
      workspaceId: 'ws-b',
      strategy: 'fork',
      sessionId: 'b-1',
    }).ok,
    true,
  )
})

test('buildExecutionContext reports missing Host services instead of guessing', async () => {
  const result = await buildExecutionContext({})
  assert.equal(result.available, false)
  assert.match(result.reason, /workspace registry and session persistence/)
  assert.deepEqual(result.workspaces, [])
  assert.deepEqual(result.sessions, [])
})

test('buildExecutionContext reads workspaces, stored sessions, live state and titles', async () => {
  const liveSession = { id: 'session-1' }
  const result = await buildExecutionContext({
    workspaceRegistry: {
      list: () => [
        {
          id: 'ws-a',
          title: 'Workspace A',
          path: '/work/a',
          sessionIds: ['session-1', 'session-2'],
          status: async () => 'ok',
        },
        {
          id: 'ws-b',
          title: 'Workspace B',
          path: '/work/b',
          sessionIds: [],
          status: async () => {
            throw new Error('stat failed')
          },
        },
      ],
    },
    sessionPersistence: {
      list: async () => [
        { header: { id: 'session-1', cwd: '/work/a', createdAt: 10 }, eventCount: 5 },
        { header: { id: 'session-2', cwd: '/work/a', createdAt: 20 }, eventCount: 0 },
      ],
    },
    sessions: { get: (id) => (id === 'session-1' ? liveSession : undefined) },
    sessionTitle: { get: (session) => (session === liveSession ? { title: 'Live work' } : undefined) },
  })

  assert.equal(result.available, true)
  assert.deepEqual(
    result.workspaces.map((entry) => [entry.id, entry.availability, entry.available]),
    [
      ['ws-a', 'ok', true],
      ['ws-b', 'unknown', false],
    ],
  )
  const first = result.sessions.find((session) => session.sessionId === 'session-1')
  assert.equal(first.title, 'Live work')
  assert.equal(first.live, true)
  assert.equal(first.suitableForReuse, true)
  const blank = result.sessions.find((session) => session.sessionId === 'session-2')
  assert.equal(blank.blank, true)
  assert.equal(blank.suitableForFork, false)
})

test('buildExecutionContext turns persistence read failures into an unavailable context', async () => {
  const result = await buildExecutionContext({
    workspaceRegistry: {
      list: () => [
        {
          id: 'ws-a',
          title: 'Workspace A',
          path: '/work/a',
          sessionIds: [],
          status: async () => 'ok',
        },
      ],
    },
    sessionPersistence: {
      list: async () => {
        throw new Error('persistence offline')
      },
    },
  })
  assert.equal(result.available, false)
  assert.match(result.reason, /persistence offline/)
})
