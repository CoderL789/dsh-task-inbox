import assert from 'node:assert/strict'
import test from 'node:test'

import {
  describeSessionChoice,
  validateDispatchPreconditions,
} from '../lib/host/dispatch-plan.js'

function base(overrides = {}) {
  return {
    confirmed: true,
    requestId: 'req-1',
    strategy: 'new',
    todo: { id: 'todo-1', title: 'Task' },
    workspace: { id: 'ws-a', path: '/work/a', available: true },
    ...overrides,
  }
}

const source = { id: 'session-src', workspaceId: 'ws-a', blankState: 'non-blank' }
const blankSource = { id: 'session-blank', workspaceId: 'ws-a', blankState: 'blank' }
const unknownSource = { id: 'session-unknown', workspaceId: 'ws-a', blankState: 'unknown' }
const freshTarget = { id: 'session-new', workspaceId: 'ws-a', blankState: 'blank' }

test('dispatch requires explicit user confirmation and a request id', () => {
  assert.equal(validateDispatchPreconditions(base({ confirmed: false })).code, 'not_confirmed')
  assert.equal(validateDispatchPreconditions(base({ requestId: '  ' })).code, 'invalid_request_id')
  assert.equal(
    validateDispatchPreconditions(base({ requestId: 'x'.repeat(129) })).code,
    'invalid_request_id',
  )
})

test('dispatch re-validates the Todo and Workspace', () => {
  assert.equal(validateDispatchPreconditions(base({ todo: undefined })).code, 'todo_not_found')
  assert.equal(
    validateDispatchPreconditions(base({ workspace: undefined })).code,
    'workspace_not_found',
  )
  assert.equal(
    validateDispatchPreconditions(base({ workspace: { id: 'ws-a', path: '/work/a', available: false } }))
      .code,
    'workspace_unavailable',
  )
})

test('new strategy accepts a fresh target and rejects a used one', () => {
  assert.deepEqual(validateDispatchPreconditions(base()), { ok: true })
  assert.deepEqual(validateDispatchPreconditions(base({ targetSession: freshTarget })), { ok: true })
  assert.equal(
    validateDispatchPreconditions(base({ targetSession: source })).code,
    'session_not_blank',
  )
  assert.equal(
    validateDispatchPreconditions(base({ sourceSession: source })).code,
    'session_required',
  )
})

test('reuse requires a non-blank source in the selected workspace', () => {
  assert.deepEqual(
    validateDispatchPreconditions(base({ strategy: 'reuse', sourceSession: source })),
    { ok: true },
  )
  assert.equal(
    validateDispatchPreconditions(base({ strategy: 'reuse' })).code,
    'session_required',
  )
  assert.equal(
    validateDispatchPreconditions(base({ strategy: 'reuse', sourceSession: blankSource })).code,
    'session_blank',
  )
  assert.equal(
    validateDispatchPreconditions(base({ strategy: 'reuse', sourceSession: unknownSource })).code,
    'session_state_unknown',
  )
  assert.equal(
    validateDispatchPreconditions(
      base({
        strategy: 'reuse',
        sourceSession: { id: 'session-src', workspaceId: 'ws-b', blankState: 'non-blank' },
      }),
    ).code,
    'session_wrong_workspace',
  )
  assert.equal(
    validateDispatchPreconditions(
      base({ strategy: 'reuse', sourceSession: source, targetSession: { ...freshTarget, blankState: 'non-blank' } }),
    ).code,
    'session_not_found',
  )
})

test('fork validates the source and (when known) the fresh child', () => {
  assert.deepEqual(
    validateDispatchPreconditions(base({ strategy: 'fork', sourceSession: source })),
    { ok: true },
  )
  assert.equal(
    validateDispatchPreconditions(base({ strategy: 'fork', sourceSession: unknownSource })).code,
    'session_state_unknown',
  )
  assert.deepEqual(
    validateDispatchPreconditions(
      base({ strategy: 'fork', sourceSession: source, targetSession: freshTarget }),
    ),
    { ok: true },
  )
  assert.equal(
    validateDispatchPreconditions(
      base({ strategy: 'fork', sourceSession: source, targetSession: source }),
    ).code,
    'session_not_found',
  )
})

test('unnamed sessions fall back to short id plus creation time', () => {
  const named = describeSessionChoice({
    sessionId: '1234567890abcdef',
    title: 'DSH Task Inbox 插件搭建',
    createdAt: 1_700_000_000_000,
  })
  assert.equal(named.label, 'DSH Task Inbox 插件搭建')
  assert.equal(named.primary, 'title')
  assert.equal(named.shortId, '12345678')

  const unnamed = describeSessionChoice({
    sessionId: '1234567890abcdef',
    title: '   ',
    createdAt: 1_700_000_000_000,
  })
  assert.equal(unnamed.primary, 'created-time+short-id')
  assert.equal(unnamed.shortId, '12345678')
  assert.equal(unnamed.createdIso, new Date(1_700_000_000_000).toISOString())
  assert.match(unnamed.label, /^12345678 · /)

  const noTime = describeSessionChoice({ sessionId: 'short' })
  assert.equal(noTime.label, 'short')
  assert.equal(noTime.primary, 'short-id')

  // Two unnamed sessions remain distinguishable by short id/time.
  const first = describeSessionChoice({ sessionId: 'aaaaaaaa-1', createdAt: 1 })
  const second = describeSessionChoice({ sessionId: 'bbbbbbbb-2', createdAt: 2 })
  assert.notEqual(first.label, second.label)
})
