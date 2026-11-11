import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

/**
 * Load the real compiled Client bundle in a VM with a fake window/loader and
 * exercise its dispatch orchestration through the exported test hook. React is
 * never required: only the module-scope orchestration functions run.
 */
function loadClientTestHooks() {
  const code = readFileSync(new URL('../lib/client/index.js', import.meta.url), 'utf8')
  const windowObject = { __ModuleLoader__: { load() {} } }
  const context = {
    window: windowObject,
    console,
    Date,
    Math,
    URL,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    AbortController,
    Promise,
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(code, context, { filename: 'lib/client/index.js' })
  return windowObject.__DSH_TASK_INBOX_TEST__
}

const hooks = loadClientTestHooks()

function baseRecord(overrides = {}) {
  return {
    executionId: 'exec-1',
    clientRequestId: 'client-1',
    requestId: 'req-1',
    todoId: 'todo-1',
    todoTitle: 'Task',
    promptText: 'Task\n\nDetails',
    strategy: 'new',
    workspaceId: 'ws-a',
    workspacePath: '/work/a',
    status: 'prepared',
    createdAt: '2026-11-10T10:00:00.000Z',
    updatedAt: '2026-11-10T10:00:00.000Z',
    ...overrides,
  }
}

class FakeHost {
  constructor(options = {}) {
    this.calls = []
    this.record = baseRecord(options.record)
    this.sessionReadyError = options.sessionReadyError
    this.verifiedStatus = options.verifiedStatus
    this.resultFailures = options.resultFailures ?? 0
    this.authorizeDisabled = options.authorizeDisabled ?? false
    this.recoveryDisabled = options.recoveryDisabled ?? false
    this.acquired = false
  }

  async status(executionId) {
    this.calls.push(['status', executionId])
    return this.record
  }

  async acquire(executionId) {
    this.calls.push(['acquire', executionId])
    if (this.acquired || this.record.status !== 'prepared') {
      return { execution: this.record, acquired: false }
    }
    this.acquired = true
    this.record = { ...this.record, status: 'dispatching' }
    return { execution: this.record, acquired: true }
  }

  async authorizePromptRetry(executionId) {
    this.calls.push(['authorizePromptRetry', executionId])
    if (this.authorizeDisabled || this.record.status !== 'unknown' || this.record.targetSessionId === undefined) {
      return { execution: this.record, authorized: false }
    }
    this.record = { ...this.record, status: 'dispatching' }
    return { execution: this.record, authorized: true }
  }

  async recoverReuse(executionId) {
    this.calls.push(['recoverReuse', executionId])
    if (
      this.recoveryDisabled ||
      this.record.strategy !== 'reuse' ||
      this.record.sourceSessionId === undefined
    ) {
      this.record = {
        ...this.record,
        status: 'unknown',
        errorCode: 'recovery_verification_unavailable',
      }
      return { execution: this.record, recovered: false }
    }
    this.record = {
      ...this.record,
      status: 'session_ready',
      targetSessionId: this.record.sourceSessionId,
    }
    return { execution: this.record, recovered: true }
  }

  async intent(input) {
    this.calls.push(['intent', input])
    return this.record
  }

  async dispatching(executionId) {
    this.calls.push(['dispatching', executionId])
    this.record = { ...this.record, status: 'dispatching' }
    return this.record
  }

  async sessionReady(executionId, sessionId) {
    this.calls.push(['sessionReady', executionId, sessionId])
    if (this.sessionReadyError !== undefined) throw this.sessionReadyError
    this.record = { ...this.record, status: 'session_ready', targetSessionId: sessionId }
    return this.record
  }

  async result(executionId, outcome, errorCode) {
    this.calls.push(['result', executionId, outcome, errorCode])
    if (this.resultFailures > 0) {
      this.resultFailures -= 1
      throw new Error('host result request failed')
    }
    const status =
      outcome === 'accepted'
        ? (this.verifiedStatus ?? 'accepted')
        : outcome === 'failed'
          ? 'failed'
          : 'unknown'
    this.record = { ...this.record, status, errorCode }
    return this.record
  }

  async unknown(executionId, errorCode) {
    this.calls.push(['unknown', executionId, errorCode])
    this.record = { ...this.record, status: 'unknown', errorCode }
    return this.record
  }

  async failed(executionId, errorCode) {
    this.calls.push(['failed', executionId, errorCode])
    this.record = { ...this.record, status: 'failed', errorCode }
    return this.record
  }
}

class FakeSessions {
  constructor(options = {}) {
    this.calls = []
    this.options = options
    this.createdId = options.createdId ?? 'session-created'
    this.childId = options.childId ?? 'session-child'
  }

  async refresh() {
    this.calls.push(['refresh'])
  }

  async create(input) {
    this.calls.push(['create', input])
    if (this.options.createError !== undefined) throw this.options.createError
    return this.createdId
  }

  async fork(input) {
    this.calls.push(['fork', input])
    if (this.options.forkError !== undefined) throw this.options.forkError
    return this.childId
  }

  retain(id, options) {
    this.calls.push(['retain', id, options])
    const ready =
      this.options.readyError === undefined
        ? Promise.resolve()
        : Promise.reject(this.options.readyError)
    return {
      ready,
      binding: {
        session: {
          prompt: async (...args) => {
            this.calls.push(['prompt', id, ...args])
            if (this.options.promptThrow !== undefined) throw this.options.promptThrow
            return this.options.promptResult ?? { ok: true }
          },
        },
      },
      release: () => this.calls.push(['release', id]),
    }
  }
}

function intentInput(overrides = {}) {
  return {
    clientRequestId: 'client-1',
    todoId: 'todo-1',
    strategy: 'new',
    workspaceId: 'ws-a',
    ...overrides,
  }
}

function callNames(sessions) {
  return sessions.calls.map((call) => call[0])
}

/** VM-realm objects need normalization before deep equality. */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test('new-session dispatch creates, persists the actual id, then prompts with the same requestId', async () => {
  const host = new FakeHost()
  const sessions = new FakeSessions()
  const result = await hooks.runDispatchFlow({ host, sessions }, intentInput())

  assert.equal(result.status, 'accepted')
  assert.equal(result.sessionId, 'session-created')
  assert.deepEqual(callNames(sessions), ['create', 'retain', 'prompt', 'release'])
  assert.deepEqual(plain(sessions.calls[0][1]), { workspaceId: 'ws-a' })

  const promptCall = sessions.calls.find((call) => call[0] === 'prompt')
  assert.equal(promptCall[3], 'queue') // mode
  assert.equal(promptCall[5], 'req-1') // requestId used for the Remote prompt
  assert.equal(promptCall[2][0].text, 'Task\n\nDetails')

  // The execution id is persisted before the prompt call, and the result
  // report happens after it.
  const names = host.calls.map((call) => call[0])
  assert.deepEqual(names, ['intent', 'acquire', 'sessionReady', 'status', 'dispatching', 'result'])
  assert.deepEqual(host.calls[2], ['sessionReady', 'exec-1', 'session-created'])
})

test('a definite create failure is reported as failed and never prompts', async () => {
  const error = Object.assign(new Error('create failed'), {
    name: 'SessionCreateError',
    error: { code: 'session/conflict' },
  })
  const host = new FakeHost()
  const sessions = new FakeSessions({ createError: error })
  const result = await hooks.runDispatchFlow({ host, sessions }, intentInput())

  assert.equal(result.status, 'failed')
  assert.equal(result.errorCode, 'session/conflict')
  assert.equal(host.calls.some((call) => call[0] === 'failed'), true)
  assert.equal(callNames(sessions).includes('prompt'), false)
})

test('an ambiguous create failure is reported as unknown (never retried automatically)', async () => {
  const host = new FakeHost()
  const sessions = new FakeSessions({ createError: new Error('socket closed') })
  const result = await hooks.runDispatchFlow({ host, sessions }, intentInput())

  assert.equal(result.status, 'unknown')
  assert.equal(host.calls.some((call) => call[0] === 'unknown'), true)
  assert.equal(callNames(sessions).filter((name) => name === 'create').length, 1)
  assert.equal(callNames(sessions).includes('prompt'), false)
})

test('a network error that happens to carry a code is still unknown', async () => {
  const error = Object.assign(new Error('connection lost'), {
    name: 'SessionCreateError',
    code: 'connection/lost',
  })
  const host = new FakeHost()
  const sessions = new FakeSessions({ createError: error })
  const result = await hooks.runDispatchFlow({ host, sessions }, intentInput())

  assert.equal(result.status, 'unknown')
  assert.equal(host.calls.some((call) => call[0] === 'unknown'), true)
  assert.equal(host.calls.some((call) => call[0] === 'failed'), false)
  assert.equal(callNames(sessions).includes('prompt'), false)
})

test('an allowlisted Host rejection is a definite failure', async () => {
  const error = Object.assign(new Error('session conflict'), {
    name: 'SessionCreateError',
    error: { code: 'session/conflict' },
  })
  const host = new FakeHost()
  const sessions = new FakeSessions({ createError: error })
  const result = await hooks.runDispatchFlow({ host, sessions }, intentInput())

  assert.equal(result.status, 'failed')
  assert.equal(host.calls.some((call) => call[0] === 'failed'), true)
  assert.equal(host.calls.some((call) => call[0] === 'unknown'), false)
  assert.equal(callNames(sessions).includes('prompt'), false)
})

test('created Session with unpersisted association is surfaced without prompting', async () => {
  const host = new FakeHost({ sessionReadyError: new Error('storage failed') })
  const sessions = new FakeSessions()
  const result = await hooks.runDispatchFlow({ host, sessions }, intentInput())

  assert.equal(result.status, 'error')
  assert.equal(result.sessionId, 'session-created')
  assert.equal(callNames(sessions).includes('prompt'), false)
  assert.equal(callNames(sessions).includes('retain'), false)
})

test('reuse refreshes the catalog, retains the source and prompts it', async () => {
  const host = new FakeHost({
    record: baseRecord({ strategy: 'reuse', sourceSessionId: 'session-src' }),
  })
  const sessions = new FakeSessions()
  const result = await hooks.runDispatchFlow(
    { host, sessions },
    intentInput({ strategy: 'reuse', sourceSessionId: 'session-src' }),
  )

  assert.equal(result.status, 'accepted')
  assert.equal(callNames(sessions).includes('create'), false)
  assert.deepEqual(plain(sessions.calls[0]), ['refresh'])
  assert.deepEqual(plain(sessions.calls[1][0]), 'retain')
  assert.equal(sessions.calls[1][1], 'session-src')
  assert.deepEqual(plain(sessions.calls[1][2]), { source: 'controllerOperation' })
  assert.equal(host.calls.find((call) => call[0] === 'sessionReady')[2], 'session-src')
})

test('fork disables migration and prompts the returned child', async () => {
  const host = new FakeHost({
    record: baseRecord({ strategy: 'fork', sourceSessionId: 'session-src' }),
  })
  const sessions = new FakeSessions({ childId: 'session-child' })
  const result = await hooks.runDispatchFlow(
    { host, sessions },
    intentInput({ strategy: 'fork', sourceSessionId: 'session-src' }),
  )

  assert.equal(result.status, 'accepted')
  const forkCall = sessions.calls.find((call) => call[0] === 'fork')
  assert.deepEqual(plain(forkCall[1]), { sessionId: 'session-src', allowMigration: false })
  assert.equal(host.calls.find((call) => call[0] === 'sessionReady')[2], 'session-child')
  assert.equal(sessions.calls.find((call) => call[0] === 'prompt')[1], 'session-child')
})

test('a rejected prompt is reported as failed and the reference is released', async () => {
  const host = new FakeHost()
  const sessions = new FakeSessions({
    promptResult: { ok: false, error: { code: 'remote-access/denied' } },
  })
  const result = await hooks.runDispatchFlow({ host, sessions }, intentInput())

  assert.equal(result.status, 'failed')
  assert.equal(host.calls.some((call) => call[0] === 'result' && call[2] === 'failed'), true)
  assert.equal(callNames(sessions).includes('release'), true)
})

test('a thrown prompt is reported as unknown and the reference is released', async () => {
  const host = new FakeHost()
  const sessions = new FakeSessions({ promptThrow: new Error('connection lost') })
  const result = await hooks.runDispatchFlow({ host, sessions }, intentInput())

  assert.equal(result.status, 'unknown')
  assert.equal(host.calls.some((call) => call[0] === 'result' && call[2] === 'unknown'), true)
  assert.equal(callNames(sessions).includes('release'), true)
})

test('Host verification pending keeps the execution in dispatching', async () => {
  const host = new FakeHost({ verifiedStatus: 'dispatching' })
  const sessions = new FakeSessions()
  const result = await hooks.runDispatchFlow({ host, sessions }, intentInput())
  assert.equal(result.status, 'dispatching')
})

test('retain ready failure leaves the execution resumable without a prompt', async () => {
  const host = new FakeHost()
  const sessions = new FakeSessions({ readyError: new Error('history failed') })
  const result = await hooks.runDispatchFlow({ host, sessions }, intentInput())

  assert.equal(result.status, 'session_ready')
  assert.equal(callNames(sessions).includes('prompt'), false)
  assert.equal(callNames(sessions).includes('release'), true)
})

test('continueDispatch never creates/fork again, only re-prompts the persisted target', async () => {
  const host = new FakeHost({
    record: baseRecord({ status: 'session_ready', targetSessionId: 'session-ready' }),
  })
  const sessions = new FakeSessions()
  const record = baseRecord({
    status: 'session_ready',
    targetSessionId: 'session-ready',
  })
  const result = await hooks.continueDispatch({ host, sessions }, record)

  assert.equal(result.status, 'accepted')
  assert.deepEqual(callNames(sessions), ['retain', 'prompt', 'release'])
  const prompt = sessions.calls.find((call) => call[0] === 'prompt')
  assert.equal(prompt[5], 'req-1')
})

test('an already-dispatching duplicate intent does not create a Session again', async () => {
  const host = new FakeHost({ record: baseRecord({ status: 'dispatching' }) })
  const sessions = new FakeSessions()
  const result = await hooks.runDispatchFlow({ host, sessions }, intentInput())

  assert.equal(result.status, 'dispatching')
  assert.deepEqual(callNames(sessions), [])
})

test('missing Session API disables dispatch without any Host side effects', async () => {
  const result = await hooks.runDispatchFlow({ host: new FakeHost() }, intentInput())
  assert.equal(result.status, 'unavailable')
})

test('Prompt accepted but Host result update failed stays pending with its ids', async () => {
  const host = new FakeHost({ resultFailures: 1 })
  const sessions = new FakeSessions()
  const result = await hooks.runDispatchFlow({ host, sessions }, intentInput())

  assert.equal(result.status, 'dispatching')
  assert.equal(result.errorCode, 'host_result_unavailable')
  assert.equal(result.execution.executionId, 'exec-1')
  assert.equal(result.execution.requestId, 'req-1')
  assert.equal(result.sessionId, 'session-created')
  assert.equal(result.execution.targetSessionId, 'session-created')
  assert.equal(callNames(sessions).filter((name) => name === 'create').length, 1)
})

test('after a page refresh, a pending execution can be resumed without a new Session', async () => {
  const host = new FakeHost({ resultFailures: 1 })
  const sessions = new FakeSessions()
  const first = await hooks.runDispatchFlow({ host, sessions }, intentInput())
  assert.equal(first.status, 'dispatching')

  // Reload hands the persisted record (status dispatching, target Session)
  // back to the orchestration; re-prompting uses the same requestId and does
  // not create/fork another Session.
  const resumed = await hooks.resumeDispatchFlow(
    { host, sessions },
    { ...first.execution, status: 'dispatching', targetSessionId: 'session-created' },
  )
  assert.equal(resumed.status, 'accepted')
  const prompts = sessions.calls.filter((call) => call[0] === 'prompt')
  assert.equal(prompts.length, 2)
  assert.equal(prompts[0][5], 'req-1')
  assert.equal(prompts[1][5], 'req-1')
  assert.equal(callNames(sessions).filter((name) => name === 'create').length, 1)
  assert.equal(host.calls.filter((call) => call[0] === 'intent').length, 1)
})

test('resumeDispatchFlow resumes a prepared execution without a new intent', async () => {
  const host = new FakeHost()
  const sessions = new FakeSessions()
  const record = baseRecord({ status: 'prepared' })
  const result = await hooks.resumeDispatchFlow({ host, sessions }, record)

  assert.equal(result.status, 'accepted')
  assert.equal(host.calls.filter((call) => call[0] === 'intent').length, 0)
  assert.deepEqual(callNames(sessions), ['create', 'retain', 'prompt', 'release'])
})

test('resumeDispatchFlow never re-creates when the target is unknown', async () => {
  const host = new FakeHost({
    record: baseRecord({ status: 'unknown', targetSessionId: undefined }),
  })
  const sessions = new FakeSessions()
  const record = baseRecord({ status: 'unknown', targetSessionId: undefined })
  const result = await hooks.resumeDispatchFlow({ host, sessions }, record)

  assert.equal(result.status, 'unknown')
  assert.deepEqual(callNames(sessions), [])
})

// ---------------------------------------------------------------------------
// Review round 2: exclusive create/fork, safe unknown Prompt recovery
// ---------------------------------------------------------------------------

test('two clients dispatching the same prepared intent create at most one Session', async () => {
  const host = new FakeHost()
  const sessions = new FakeSessions()
  const input = intentInput()
  const results = await Promise.all([
    hooks.runDispatchFlow({ host, sessions }, input),
    hooks.runDispatchFlow({ host, sessions }, input),
  ])

  assert.equal(callNames(sessions).filter((name) => name === 'create').length, 1)
  assert.equal(callNames(sessions).filter((name) => name === 'prompt').length, 1)
  assert.equal(results.filter((entry) => entry.status === 'accepted').length, 1)
  const loser = results.find((entry) => entry.status !== 'accepted')
  assert.equal(loser.errorCode, 'dispatch_lease_not_acquired')
  assert.equal(host.calls.filter((call) => call[0] === 'acquire').length, 2)
})

test('unknown + target recovery verifies the log, authorizes one retry and never create/fork', async () => {
  const target = 'session-existing'
  const host = new FakeHost({
    record: baseRecord({ status: 'unknown', targetSessionId: target }),
  })
  const sessions = new FakeSessions()
  const record = baseRecord({ status: 'unknown', targetSessionId: target })
  const result = await hooks.resumeDispatchFlow({ host, sessions }, record)

  assert.equal(result.status, 'accepted')
  assert.equal(callNames(sessions).includes('create'), false)
  assert.equal(callNames(sessions).includes('fork'), false)
  const prompt = sessions.calls.find((call) => call[0] === 'prompt')
  assert.equal(prompt[1], target)
  assert.equal(prompt[5], 'req-1')
  assert.equal(prompt[2][0].text, record.promptText)
  assert.equal(host.calls.filter((call) => call[0] === 'authorizePromptRetry').length, 1)
})

test('a stale Client cannot re-send an already accepted Prompt', async () => {
  const target = 'session-accepted'
  const host = new FakeHost({
    record: baseRecord({ status: 'accepted', targetSessionId: target }),
  })
  const sessions = new FakeSessions()
  const stale = baseRecord({
    status: 'unknown',
    targetSessionId: target,
    executionId: 'exec-1',
  })
  const result = await hooks.resumeDispatchFlow({ host, sessions }, stale)

  assert.equal(result.status, 'accepted')
  assert.equal(callNames(sessions).length, 0)
  assert.equal(host.calls.some((call) => call[0] === 'authorizePromptRetry'), false)
})

test('a direct prompt continuation does not treat unknown as session_ready', async () => {
  const target = 'session-existing'
  const host = new FakeHost({
    record: baseRecord({ status: 'unknown', targetSessionId: target }),
  })
  const sessions = new FakeSessions()
  const result = await hooks.continueDispatch(
    { host, sessions },
    baseRecord({ status: 'unknown', targetSessionId: target }),
  )

  assert.equal(result.status, 'unknown')
  assert.equal(result.errorCode, 'prompt_retry_not_authorized')
  assert.equal(callNames(sessions).length, 0)
})

test('concurrent unknown recovery never create/fork and converges to accepted', async () => {
  const target = 'session-existing'
  const host = new FakeHost({
    record: baseRecord({ status: 'unknown', targetSessionId: target }),
  })
  const sessions = new FakeSessions()
  const record = baseRecord({ status: 'unknown', targetSessionId: target })

  const results = await Promise.all([
    hooks.resumeDispatchFlow({ host, sessions }, record),
    hooks.resumeDispatchFlow({ host, sessions }, record),
  ])
  assert.equal(callNames(sessions).includes('create'), false)
  assert.equal(callNames(sessions).includes('fork'), false)
  assert.equal(results.filter((entry) => entry.status === 'accepted').length >= 1, true)
  assert.equal(sessions.calls.filter((call) => call[0] === 'prompt').length <= 2, true)
})

// ---------------------------------------------------------------------------
// Review round 3: reuse binding recovery and conservative retry authorization
// ---------------------------------------------------------------------------

test('reuse association failure recovers the source Session without create/fork', async () => {
  const source = 'session-src'
  const host = new FakeHost({
    record: baseRecord({
      strategy: 'reuse',
      status: 'dispatching',
      sourceSessionId: source,
    }),
  })
  const sessions = new FakeSessions()
  const stale = baseRecord({
    strategy: 'reuse',
    status: 'dispatching',
    sourceSessionId: source,
  })
  const result = await hooks.resumeDispatchFlow({ host, sessions }, stale)

  assert.equal(result.status, 'accepted')
  assert.equal(callNames(sessions).includes('create'), false)
  assert.equal(callNames(sessions).includes('fork'), false)
  const prompt = sessions.calls.find((call) => call[0] === 'prompt')
  assert.equal(prompt[1], source)
  assert.equal(prompt[5], 'req-1')
  assert.equal(prompt[2][0].text, stale.promptText)
  assert.equal(host.calls.filter((call) => call[0] === 'recoverReuse').length, 1)
})

test('reuse recovery keeps unknown and sends no Prompt when the log is unreadable', async () => {
  const source = 'session-src'
  const host = new FakeHost({
    record: baseRecord({
      strategy: 'reuse',
      status: 'dispatching',
      sourceSessionId: source,
    }),
    recoveryDisabled: true,
  })
  const sessions = new FakeSessions()
  const stale = baseRecord({
    strategy: 'reuse',
    status: 'dispatching',
    sourceSessionId: source,
  })
  const result = await hooks.resumeDispatchFlow({ host, sessions }, stale)

  assert.equal(result.status, 'unknown')
  assert.equal(result.errorCode, 'recovery_verification_unavailable')
  assert.equal(callNames(sessions).length, 0)
})

test('unknown recovery is blocked when the Host cannot verify the log', async () => {
  const target = 'session-existing'
  const host = new FakeHost({
    record: baseRecord({ status: 'unknown', targetSessionId: target }),
    authorizeDisabled: true,
  })
  const sessions = new FakeSessions()
  const result = await hooks.resumeDispatchFlow(
    { host, sessions },
    baseRecord({ status: 'unknown', targetSessionId: target }),
  )

  assert.equal(result.status, 'unknown')
  assert.equal(result.errorCode, 'prompt_retry_not_authorized')
  assert.equal(callNames(sessions).length, 0)
})

// ---------------------------------------------------------------------------
// Task 03B final UI: execution history selection and session field mapping
// ---------------------------------------------------------------------------

function historyRecord(overrides = {}) {
  return baseRecord({
    executionId: 'exec-old',
    requestId: 'req-old',
    strategy: 'reuse',
    status: 'unknown',
    createdAt: '2026-11-10T10:00:00.000Z',
    sourceSessionId: 'session-src',
    targetSessionId: undefined,
    ...overrides,
  })
}

test('multiple unresolved executions can be listed and selected individually', () => {
  const accepted = historyRecord({
    executionId: 'exec-accepted',
    status: 'accepted',
    createdAt: '2026-11-10T12:00:00.000Z',
    targetSessionId: 'session-a',
  })
  const olderUnknown = historyRecord({
    executionId: 'exec-old',
    status: 'unknown',
    createdAt: '2026-11-10T09:00:00.000Z',
  })
  const newerDispatching = historyRecord({
    executionId: 'exec-new',
    status: 'dispatching',
    createdAt: '2026-11-10T11:00:00.000Z',
  })
  const records = [accepted, newerDispatching, olderUnknown]

  const unresolved = hooks.unresolvedExecutions(records)
  assert.deepEqual(
    unresolved.map((entry) => entry.executionId),
    ['exec-new', 'exec-old'],
  )
  // Latest accepted must not hide an earlier unresolved execution.
  assert.equal(hooks.defaultHistorySelection(records).executionId, 'exec-new')
  assert.equal(
    hooks.defaultHistorySelection(records, 'exec-old').executionId,
    'exec-old',
  )
})

test('selecting execution history is side-effect free and uses that record', async () => {
  const older = historyRecord({
    executionId: 'exec-old',
    requestId: 'req-old',
    strategy: 'reuse',
    status: 'dispatching',
    sourceSessionId: 'session-src',
  })
  const newer = historyRecord({
    executionId: 'exec-new',
    requestId: 'req-new',
    status: 'dispatching',
    sourceSessionId: 'session-src',
  })
  const selected = hooks.defaultHistorySelection([newer, older], 'exec-old')
  assert.equal(selected.executionId, 'exec-old')

  // Selecting alone (the helper) performs no Session operation.
  const sessions = new FakeSessions()
  assert.equal(callNames(sessions).length, 0)

  // Recovering the selected record sends its own requestId, not the other one.
  const host = new FakeHost({
    record: {
      ...older,
      status: 'dispatching',
      targetSessionId: undefined,
    },
  })
  const result = await hooks.resumeDispatchFlow({ host, sessions }, selected)
  assert.equal(result.status, 'accepted')
  assert.equal(callNames(sessions).includes('create'), false)
  assert.equal(callNames(sessions).includes('fork'), false)
  const prompt = sessions.calls.find((call) => call[0] === 'prompt')
  assert.equal(prompt[5], 'req-old')
})

test('switching Todo resets prior execution selection state', () => {
  const reset = hooks.emptyExecutionHistory()
  assert.equal(Array.isArray(reset.records), true)
  assert.equal(reset.records.length, 0)
  assert.equal(reset.selectedExecutionId, null)
})

test('source and target Session fields follow the dispatch strategy', () => {
  const newFields = hooks.executionSessionFields({
    strategy: 'new',
    sourceSessionId: undefined,
    targetSessionId: 'session-new',
  })
  assert.equal(newFields.source, undefined)
  assert.equal(newFields.target, 'session-new')
  assert.equal(newFields.shared, false)
  assert.equal(newFields.targetMissing, false)

  const reuseFields = hooks.executionSessionFields({
    strategy: 'reuse',
    sourceSessionId: 'session-reused',
    targetSessionId: 'session-reused',
  })
  assert.equal(reuseFields.shared, true)
  assert.equal(reuseFields.source, 'session-reused')
  assert.equal(reuseFields.target, 'session-reused')

  // A reuse pending target equal to its source must never be presented as a
  // persisted target.
  const pendingReuse = hooks.executionSessionFields(
    {
      strategy: 'reuse',
      sourceSessionId: 'session-reused',
      targetSessionId: undefined,
    },
    'session-reused',
  )
  assert.equal(pendingReuse.target, undefined)
  assert.equal(pendingReuse.shared, false)
  assert.equal(pendingReuse.targetMissing, true)

  const forkFields = hooks.executionSessionFields({
    strategy: 'fork',
    sourceSessionId: 'session-parent',
    targetSessionId: 'session-child',
  })
  assert.equal(forkFields.source, 'session-parent')
  assert.equal(forkFields.target, 'session-child')
  assert.equal(forkFields.shared, false)
  assert.equal(forkFields.targetMissing, false)
})

test('short ids distinguish unnamed Sessions and executions', () => {
  const longSession = 'session-f46e6b1f-b4c5-4eb7-85d9-769ed39f1f41'
  const short = hooks.shortSessionId(longSession)
  assert.equal(short, 'f46e6b1f')
  assert.equal(hooks.sessionShortCode(longSession, 12), 'f46e6b1f-b4c')
  assert.equal(hooks.shortExecutionId('19734deb-0cca-44cc-98e2-b345d024b4ff').endsWith('…'), true)
})

// ---------------------------------------------------------------------------
// Task 03B lifecycle/capability gate and Session labels (0.4.5)
// ---------------------------------------------------------------------------

function sessionFixture(overrides = {}) {
  return {
    sessionId: 'session-f46e6b1f-b4c5-4eb7-85d9-769ed39f1f41',
    workspaceId: 'ws-a',
    title: undefined,
    createdAt: 1_700_000_000_000,
    live: false,
    stored: true,
    blankState: 'non-blank',
    suitableForReuse: true,
    suitableForFork: true,
    unavailableReasons: [],
    warnings: [],
    ...overrides,
  }
}

const testTranslate = (key) =>
  ({
    'execution.titleUnknown': '未命名会话',
    'execution.session.blank': '空白',
    'execution.session.stateUnknown': '状态未知',
    'execution.session.notFound': '未找到',
    'execution.session.live': '活跃',
  })[key] ?? key

test('unnamed Sessions are distinguishable by short id and status suffix', () => {
  const first = sessionFixture()
  const second = sessionFixture({
    sessionId: 'session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  })
  const firstLabel = hooks.sessionDisplayLabel(testTranslate, first)
  const secondLabel = hooks.sessionDisplayLabel(testTranslate, second)
  assert.equal(firstLabel, '未命名会话 · f46e6b1f')
  assert.equal(secondLabel, '未命名会话 · aaaaaaaa')
  assert.notEqual(firstLabel, secondLabel)
})

test('named and blank Sessions keep title/status and always include a short id', () => {
  const named = hooks.sessionDisplayLabel(testTranslate, sessionFixture({ title: 'My Session' }))
  assert.equal(named, 'My Session · f46e6b1f')

  const blank = hooks.sessionDisplayLabel(
    testTranslate,
    sessionFixture({
      sessionId: 'session-bbbbbbbb-1111-2222-3333-444444444444',
      blankState: 'blank',
    }),
  )
  assert.equal(blank, '未命名会话 (空白) · bbbbbbbb')

  const unknown = hooks.sessionDisplayLabel(
    testTranslate,
    sessionFixture({
      sessionId: 'session-cccccccc-1111-2222-3333-444444444444',
      blankState: 'unknown',
    }),
  )
  assert.equal(unknown, '未命名会话 (状态未知) · cccccccc')
})

test('session short ids extend when their default 8 characters collide', () => {
  const sessions = [
    sessionFixture({ sessionId: 'session-aaaaaaaa-1' }),
    sessionFixture({ sessionId: 'session-aaaaaaaa-2' }),
  ]
  const length = hooks.sessionLabelIdLength(sessions)
  assert.equal(length > 8, true)
  const labels = sessions.map((session) => hooks.sessionDisplayLabel(testTranslate, session, length))
  assert.notEqual(labels[0], labels[1])
  assert.equal(new Set(labels).size, 2)
})

test('duplicate Session ids are shown only once', () => {
  const session = sessionFixture()
  const deduped = hooks.dedupeExecutionSessions([session, { ...session }, sessionFixture({
    sessionId: 'session-other',
  })])
  assert.equal(deduped.length, 2)
  assert.equal(deduped[0].sessionId, session.sessionId)
  assert.equal(deduped[1].sessionId, 'session-other')
})

test('canConfirmDispatch requires loaded history, capability, workspace and no conflict', () => {
  const base = {
    strategy: 'new',
    hasSelectedSourceSession: false,
    selectedSourceSessionSuitable: false,
    dispatchBusy: false,
    sessionApiAvailable: true,
    historyPhase: 'loaded',
    dispatchReady: true,
    capabilityChecking: false,
    workspaceReady: true,
    hasUnresolvedExecution: false,
    hasCurrentExecution: false,
  }
  assert.equal(hooks.canConfirmDispatch(base), true)
  assert.equal(hooks.canConfirmDispatch({ ...base, historyPhase: 'loading' }), false)
  assert.equal(hooks.canConfirmDispatch({ ...base, historyPhase: 'error' }), false)
  assert.equal(hooks.canConfirmDispatch({ ...base, dispatchReady: false }), false)
  assert.equal(hooks.canConfirmDispatch({ ...base, capabilityChecking: true }), false)
  assert.equal(hooks.canConfirmDispatch({ ...base, sessionApiAvailable: false }), false)
  assert.equal(hooks.canConfirmDispatch({ ...base, workspaceReady: false }), false)
  assert.equal(hooks.canConfirmDispatch({ ...base, hasUnresolvedExecution: true }), false)
  assert.equal(hooks.canConfirmDispatch({ ...base, hasCurrentExecution: true }), false)
  assert.equal(hooks.canConfirmDispatch({ ...base, dispatchBusy: true }), false)
})

test('selectedSourceSessionGate validates the selected Session for the active strategy', () => {
  const sessions = [
    { sessionId: 'reuse-session', suitableForReuse: true, suitableForFork: false },
    { sessionId: 'fork-session', suitableForReuse: false, suitableForFork: true },
  ]

  const reuse = hooks.selectedSourceSessionGate(sessions, 'reuse-session', 'reuse')
  assert.equal(reuse.hasSelectedSourceSession, true)
  assert.equal(reuse.selectedSourceSessionSuitable, true)

  const unsuitable = hooks.selectedSourceSessionGate(sessions, 'reuse-session', 'fork')
  assert.equal(unsuitable.hasSelectedSourceSession, true)
  assert.equal(unsuitable.selectedSourceSessionSuitable, false)

  const missing = hooks.selectedSourceSessionGate(sessions, 'missing-session', 'reuse')
  assert.equal(missing.hasSelectedSourceSession, false)
  assert.equal(missing.selectedSourceSessionSuitable, false)
})

test('canConfirmDispatch requires a suitable source Session for reuse and fork, but not new', () => {
  const base = {
    strategy: 'new', hasSelectedSourceSession: false, selectedSourceSessionSuitable: false,
    dispatchBusy: false, sessionApiAvailable: true, historyPhase: 'loaded', dispatchReady: true,
    capabilityChecking: false, workspaceReady: true, hasUnresolvedExecution: false, hasCurrentExecution: false,
  }
  assert.equal(hooks.canConfirmDispatch(base), true)
  assert.equal(hooks.canConfirmDispatch({ ...base, strategy: 'reuse' }), false)
  assert.equal(hooks.canConfirmDispatch({ ...base, strategy: 'fork' }), false)
  assert.equal(hooks.canConfirmDispatch({ ...base, strategy: 'reuse', hasSelectedSourceSession: true }), false)
  assert.equal(hooks.canConfirmDispatch({ ...base, strategy: 'reuse', hasSelectedSourceSession: true, selectedSourceSessionSuitable: true }), true)
  assert.equal(hooks.canConfirmDispatch({ ...base, strategy: 'fork', hasSelectedSourceSession: true, selectedSourceSessionSuitable: true }), true)
})

test('canDispatchSelected gates continue/recover actions on current capability', () => {
  const base = {
    dispatchBusy: false,
    sessionApiAvailable: true,
    historyPhase: 'loaded',
    dispatchReady: true,
    capabilityChecking: false,
    hasSelectedExecution: true,
  }
  assert.equal(hooks.canDispatchSelected(base), true)
  assert.equal(hooks.canDispatchSelected({ ...base, dispatchReady: false }), false)
  assert.equal(hooks.canDispatchSelected({ ...base, historyPhase: 'error' }), false)
  assert.equal(hooks.canDispatchSelected({ ...base, hasSelectedExecution: false }), false)
})

test('execution_unavailable marks capability unconfirmed until it is re-checked', () => {
  const base = {
    strategy: 'new',
    hasSelectedSourceSession: false,
    selectedSourceSessionSuitable: false,
    dispatchBusy: false,
    sessionApiAvailable: true,
    historyPhase: 'loaded',
    dispatchReady: true,
    capabilityChecking: false,
    workspaceReady: true,
    hasUnresolvedExecution: false,
    hasCurrentExecution: false,
  }
  assert.equal(hooks.canConfirmDispatch(base), true)
  const unavailable = { ...base, dispatchReady: false }
  assert.equal(hooks.canConfirmDispatch(unavailable), false)
  const rechecked = { ...unavailable, dispatchReady: true }
  assert.equal(hooks.canConfirmDispatch(rechecked), true)
})

test('concurrent reuse recovery clicks never create/fork and reuse one requestId', async () => {
  const source = 'session-src'
  const host = new FakeHost({
    record: baseRecord({
      strategy: 'reuse',
      status: 'dispatching',
      sourceSessionId: source,
    }),
  })
  const sessions = new FakeSessions()
  const selected = baseRecord({
    strategy: 'reuse',
    status: 'dispatching',
    sourceSessionId: source,
  })

  const results = await Promise.all([
    hooks.resumeDispatchFlow({ host, sessions }, selected),
    hooks.resumeDispatchFlow({ host, sessions }, selected),
  ])
  assert.equal(callNames(sessions).includes('create'), false)
  assert.equal(callNames(sessions).includes('fork'), false)
  const prompts = sessions.calls.filter((call) => call[0] === 'prompt')
  assert.equal(prompts.length >= 1, true)
  for (const prompt of prompts) assert.equal(prompt[5], 'req-1')
  assert.equal(results.some((entry) => entry.status === 'accepted'), true)
})
