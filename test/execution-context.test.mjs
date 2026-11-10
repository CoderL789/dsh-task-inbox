import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assembleExecutionContext,
  buildExecutionContext,
  detectSessionBlankState,
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
    ...overrides,
  }
}

function rawSnapshot(entry) {
  return {
    id: entry.id,
    cwd: entry.cwd,
    createdAt: entry.createdAt,
    parentSessionId: entry.parentSessionId,
    origin: entry.origin,
    eventCount: entry.eventCount,
  }
}

/** Wrap a flat descriptor in the persistence snapshot shape. */
function persisted(entry) {
  return {
    header: {
      id: entry.id,
      cwd: entry.cwd,
      createdAt: entry.createdAt,
      parentSession: entry.parentSessionId,
      origin: entry.origin,
    },
    eventCount: entry.eventCount,
  }
}

/** A fake persistence handle that serves `events` by event offset/length. */
function fakePersistence({ snapshots = [], eventsById = {}, failOpen = new Set(), failRead = new Set() }) {
  const opened = []
  const readCalls = []
  const persistence = {
    list: async () => snapshots,
    open: async (id, access) => {
      if (failOpen.has(id)) throw new Error(`open ${id} failed`)
      opened.push([id, access])
      const events = eventsById[id] ?? []
      return {
        read: async (offset = 0, length = events.length) => {
          readCalls.push([id, offset, length])
          if (failRead.has(id)) throw new Error(`read ${id} failed`)
          return { events: events.slice(offset, offset + length) }
        },
        close: async () => {},
      }
    },
  }
  return { persistence, opened, readCalls }
}

test('assembleExecutionContext uses the tri-state blank classification', () => {
  const context = assembleExecutionContext({
    workspaces: [workspace({ sessionIds: ['has-turns', 'blank', 'unknown', 'no-state'] })],
    snapshots: [
      rawSnapshot(snapshot('has-turns', { eventCount: 3 })),
      rawSnapshot(snapshot('blank', { eventCount: 0 })),
      rawSnapshot(snapshot('unknown', { eventCount: undefined })),
      rawSnapshot(snapshot('no-state', { eventCount: 1 })),
    ],
    liveSessionIds: ['has-turns'],
    titles: new Map([['has-turns', 'Existing work']]),
    blankStates: new Map([
      ['has-turns', 'non-blank'],
      ['blank', 'blank'],
      ['unknown', 'unknown'],
      // no-state deliberately missing -> conservative unknown
    ]),
  })

  const byId = new Map(context.sessions.map((session) => [session.sessionId, session]))
  assert.equal(byId.get('has-turns').blankState, 'non-blank')
  assert.equal(byId.get('has-turns').live, true)
  assert.equal(byId.get('has-turns').suitableForReuse, true)
  assert.equal(byId.get('has-turns').suitableForFork, true)
  assert.deepEqual(byId.get('has-turns').unavailableReasons, [])

  assert.equal(byId.get('blank').blankState, 'blank')
  assert.equal(byId.get('blank').suitableForReuse, false)
  assert.deepEqual(byId.get('blank').unavailableReasons, ['blank_session'])

  assert.equal(byId.get('unknown').blankState, 'unknown')
  assert.equal(byId.get('unknown').suitableForReuse, false)
  assert.equal(byId.get('unknown').suitableForFork, false)
  assert.deepEqual(byId.get('unknown').unavailableReasons, ['session_state_unknown'])

  assert.equal(byId.get('no-state').blankState, 'unknown')
  assert.deepEqual(byId.get('no-state').unavailableReasons, ['session_state_unknown'])
})

test('an absent eventCount is never treated as blank', () => {
  const context = assembleExecutionContext({
    workspaces: [workspace({ sessionIds: ['session-1'] })],
    snapshots: [rawSnapshot(snapshot('session-1', { eventCount: undefined }))],
    liveSessionIds: [],
    titles: new Map(),
    blankStates: new Map([['session-1', 'non-blank']]),
  })
  const session = context.sessions[0]
  assert.equal(session.blankState, 'non-blank')
  assert.equal(session.suitableForReuse, true)
})

test('sessions in a workspace index but missing from storage are marked not found', () => {
  const context = assembleExecutionContext({
    workspaces: [workspace({ sessionIds: ['gone-session'] })],
    snapshots: [],
    liveSessionIds: [],
    titles: new Map(),
    blankStates: new Map(),
  })
  const missing = context.sessions[0]
  assert.equal(missing.stored, false)
  assert.equal(missing.blankState, 'unknown')
  assert.equal(missing.suitableForReuse, false)
  assert.deepEqual(missing.unavailableReasons, ['session_not_found'])
})

test('subagent-origin sessions are excluded from execution candidates', () => {
  const context = assembleExecutionContext({
    workspaces: [workspace({ sessionIds: ['child'] })],
    snapshots: [rawSnapshot(snapshot('child', { origin: 'subagent', eventCount: 4 }))],
    liveSessionIds: [],
    titles: new Map(),
    blankStates: new Map([['child', 'non-blank']]),
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
    blankStates: new Map(),
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
      rawSnapshot(snapshot('a-1', { cwd: '/work/a', eventCount: 2 })),
      rawSnapshot(snapshot('b-1', { cwd: '/work/b', eventCount: 2 })),
    ],
    liveSessionIds: [],
    titles: new Map(),
    blankStates: new Map([
      ['a-1', 'non-blank'],
      ['b-1', 'non-blank'],
    ]),
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
  const context = assembleExecutionContext({
    workspaces: [workspace({ sessionIds: ['usable', 'blank', 'unknown'] })],
    snapshots: [
      rawSnapshot(snapshot('usable', { eventCount: 5 })),
      rawSnapshot(snapshot('blank', { eventCount: 0 })),
      rawSnapshot(snapshot('unknown', { eventCount: undefined })),
    ],
    liveSessionIds: [],
    titles: new Map(),
    blankStates: new Map([
      ['usable', 'non-blank'],
      ['blank', 'blank'],
      ['unknown', 'unknown'],
    ]),
  })
  const usable = context.sessions.find((session) => session.sessionId === 'usable')
  const blank = context.sessions.find((session) => session.sessionId === 'blank')
  const unknown = context.sessions.find((session) => session.sessionId === 'unknown')
  assert.equal(isSessionSuitable(usable, 'reuse'), true)
  assert.equal(isSessionSuitable(usable, 'fork'), true)
  assert.equal(isSessionSuitable(blank, 'reuse'), false)
  assert.equal(isSessionSuitable(blank, 'fork'), false)
  assert.equal(isSessionSuitable(unknown, 'reuse'), false)
  assert.equal(isSessionSuitable(unknown, 'fork'), false)
  assert.equal(isSessionSuitable(blank, 'new'), true)
})

test('validateExecutionSelection rejects unknown-state sessions conservatively', () => {
  const context = assembleExecutionContext({
    workspaces: [workspace({ sessionIds: ['usable', 'unknown'] })],
    snapshots: [
      rawSnapshot(snapshot('usable', { eventCount: 2 })),
      rawSnapshot(snapshot('unknown', { eventCount: undefined })),
    ],
    liveSessionIds: [],
    titles: new Map(),
    blankStates: new Map([
      ['usable', 'non-blank'],
      ['unknown', 'unknown'],
    ]),
  })

  assert.deepEqual(
    validateExecutionSelection(context, {
      workspaceId: 'ws-a',
      strategy: 'reuse',
      sessionId: 'usable',
    }),
    { ok: true },
  )
  assert.equal(
    validateExecutionSelection(context, {
      workspaceId: 'ws-a',
      strategy: 'reuse',
      sessionId: 'unknown',
    }).code,
    'session_unsuitable',
  )
})

test('validateExecutionSelection rejects every invalid selection shape', () => {
  const context = assembleExecutionContext({
    workspaces: [workspace({ sessionIds: ['session-1'] })],
    snapshots: [rawSnapshot(snapshot('session-1', { eventCount: 2 }))],
    liveSessionIds: ['session-1'],
    titles: new Map([['session-1', 'Existing work']]),
    blankStates: new Map([['session-1', 'non-blank']]),
  })
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
    blankStates: new Map(),
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
    snapshots: [
      rawSnapshot(snapshot('a-1', { cwd: '/work/a', eventCount: 2 })),
      rawSnapshot(snapshot('b-1', { cwd: '/work/b', eventCount: 2 })),
    ],
    liveSessionIds: [],
    titles: new Map(),
    blankStates: new Map([
      ['a-1', 'non-blank'],
      ['b-1', 'non-blank'],
    ]),
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
      workspaceId: 'ws-b',
      strategy: 'fork',
      sessionId: 'b-1',
    }).ok,
    true,
  )
})

// ---------------------------------------------------------------------------
// detectSessionBlankState: the actual read-only probe
// ---------------------------------------------------------------------------

test('eventCount 0 is confirmed blank without opening the log', async () => {
  const { persistence, opened } = fakePersistence({})
  const state = await detectSessionBlankState(
    persisted(snapshot('empty', { eventCount: 0 })),
    persistence,
  )
  assert.equal(state, 'blank')
  assert.deepEqual(opened, [])
})

test('a positive eventCount with a turn/start in the log is non-blank', async () => {
  const { persistence, opened, readCalls } = fakePersistence({
    eventsById: {
      'active-session': [{ type: 'user/message' }, { type: 'turn/start' }, { type: 'step/start' }],
    },
  })
  const state = await detectSessionBlankState(
    persisted(snapshot('active-session', { eventCount: 3 })),
    persistence,
  )
  assert.equal(state, 'non-blank')
  assert.deepEqual(opened, [['active-session', 'read']])
  assert.deepEqual(readCalls, [['active-session', 0, 200]])
})

test('an absent eventCount still confirms non-blank by reading the log', async () => {
  const { persistence } = fakePersistence({
    eventsById: {
      'real-session': [{ type: 'turn/start' }, { type: 'user/message' }],
    },
  })
  const state = await detectSessionBlankState(
    persisted(snapshot('real-session', { eventCount: undefined })),
    persistence,
  )
  assert.equal(state, 'non-blank')
})

test('a readable empty log is confirmed blank', async () => {
  const { persistence } = fakePersistence({})
  const state = await detectSessionBlankState(
    persisted(snapshot('never-used', { eventCount: undefined })),
    persistence,
  )
  assert.equal(state, 'blank')
})

test('a readable log without turn/start is confirmed blank', async () => {
  const { persistence } = fakePersistence({
    eventsById: { 'metadata-only': [{ type: 'session/title' }, { type: 'other' }] },
  })
  const state = await detectSessionBlankState(
    persisted(snapshot('metadata-only', { eventCount: 2 })),
    persistence,
  )
  assert.equal(state, 'blank')
})

test('an unreadable log is unknown, never blank', async () => {
  const openFailure = fakePersistence({ failOpen: new Set(['blocked']) })
  assert.equal(
    await detectSessionBlankState(
      persisted(snapshot('blocked', { eventCount: 5 })),
      openFailure.persistence,
    ),
    'unknown',
  )

  const readFailure = fakePersistence({ failRead: new Set(['broken']) })
  assert.equal(
    await detectSessionBlankState(
      persisted(snapshot('broken', { eventCount: 5 })),
      readFailure.persistence,
    ),
    'unknown',
  )
})

test('missing open capability with an absent eventCount is unknown', async () => {
  const persistence = { list: async () => [] }
  const state = await detectSessionBlankState(
    persisted(snapshot('no-open', { eventCount: undefined })),
    persistence,
  )
  assert.equal(state, 'unknown')
})

test('long logs are paged until a turn/start or EOF', async () => {
  const { persistence, readCalls } = fakePersistence({
    eventsById: {
      long: Array.from({ length: 450 }, (_, index) =>
        index === 420 ? { type: 'turn/start' } : { type: 'filler' },
      ),
    },
  })
  const state = await detectSessionBlankState(
    persisted(snapshot('long', { eventCount: 450 })),
    persistence,
  )
  assert.equal(state, 'non-blank')
  assert.deepEqual(
    readCalls.map((call) => call[1]),
    [0, 200, 400],
  )
})

// ---------------------------------------------------------------------------
// buildExecutionContext integration
// ---------------------------------------------------------------------------

test('buildExecutionContext reports missing Host services instead of guessing', async () => {
  const result = await buildExecutionContext({})
  assert.equal(result.available, false)
  assert.match(result.reason, /workspace registry and session persistence/)
})

test('buildExecutionContext classifies live and cold sessions from their logs', async () => {
  const liveSession = { id: 'session-live' }
  const { persistence } = fakePersistence({
    snapshots: [
      persisted(snapshot('session-live', { eventCount: undefined })),
      persisted(snapshot('session-cold', { eventCount: 4 })),
      persisted(snapshot('session-empty', { eventCount: 0 })),
      persisted(snapshot('session-blocked', { eventCount: undefined })),
    ],
    eventsById: {
      'session-live': [{ type: 'turn/start' }],
      'session-cold': [{ type: 'turn/start' }],
      'session-empty': [],
    },
    failOpen: new Set(['session-blocked']),
  })

  const result = await buildExecutionContext({
    workspaceRegistry: {
      list: () => [
        {
          id: 'ws-a',
          title: 'Workspace A',
          path: '/work/a',
          sessionIds: ['session-live', 'session-cold', 'session-empty', 'session-blocked'],
          status: async () => 'ok',
        },
      ],
    },
    sessionPersistence: persistence,
    sessions: { get: (id) => (id === 'session-live' ? liveSession : undefined) },
    sessionTitle: {
      get: (session) => (session === liveSession ? { title: 'DSH Task Inbox 插件搭建' } : undefined),
    },
  })

  assert.equal(result.available, true)
  const byId = new Map(result.sessions.map((session) => [session.sessionId, session]))

  // The reported UI bug: absent eventCount on a real, active session must not
  // be treated as blank.
  assert.equal(byId.get('session-live').blankState, 'non-blank')
  assert.equal(byId.get('session-live').live, true)
  assert.equal(byId.get('session-live').suitableForReuse, true)
  assert.equal(byId.get('session-live').title, 'DSH Task Inbox 插件搭建')

  // Cold but with history: reusable too.
  assert.equal(byId.get('session-cold').blankState, 'non-blank')
  assert.equal(byId.get('session-cold').live, false)
  assert.equal(byId.get('session-cold').suitableForReuse, true)

  // Exact zero: confirmed blank.
  assert.equal(byId.get('session-empty').blankState, 'blank')
  assert.equal(byId.get('session-empty').suitableForReuse, false)
  assert.deepEqual(byId.get('session-empty').unavailableReasons, ['blank_session'])

  // Unreadable: conservative unknown, not blank and not executable.
  assert.equal(byId.get('session-blocked').blankState, 'unknown')
  assert.equal(byId.get('session-blocked').suitableForReuse, false)
  assert.equal(byId.get('session-blocked').suitableForFork, false)
  assert.deepEqual(byId.get('session-blocked').unavailableReasons, ['session_state_unknown'])
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
