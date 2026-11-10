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
  assert.deepEqual(names, ['intent', 'dispatching', 'sessionReady', 'dispatching', 'result'])
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
  const host = new FakeHost()
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
