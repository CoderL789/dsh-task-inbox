/**
 * Client half of the DSH Task Inbox bundle (Task 02).
 *
 * Contributes (1) an independent `sidebar.panellist` entry whose id addresses
 * (2) the keyed `main` panel holding the Task Inbox page. The page talks to the
 * Host half through one same-origin JSON endpoint (`POST /plugins/dsh-task-inbox/api`)
 * and implements create / edit / delete-with-confirm / list / move-up-down with
 * localized text (zh/en) and theme-token styling only.
 *
 * Lifecycle: locale dictionaries are registered inside `ctx.effect`, so a plugin
 * re-apply disposes the previous dictionaries before registering again; slot
 * contributions go through `ctx.slots.inject`, which owns their lifetime.
 */

interface ModuleLoaderEntry {
  id: string
  factory(require: (id: string) => unknown): ClientPlugin
}

interface ClientPlugin {
  inject: string[]
  apply(ctx: ClientContext): void
}

interface DispatchCandidate {
  sessionId: string
  createdAt?: number
  blankState: 'blank' | 'non-blank' | 'unknown'
  title?: string
  manualBinding?: boolean
}

interface ClientContext {
  slots: SlotService
  locale: LocaleService
  sessions?: ClientSessionsApi
  get?<T>(name: string): T | undefined
  effect(effect: () => (() => void) | void): () => void
}

interface SlotRegistrationOptions {
  name: string
  id?: string
  key?: string
  order?: number
  label?: string | (() => string)
}

interface SlotService {
  inject(slot: string, callback: () => () => void): () => void
  register(options: SlotRegistrationOptions, component: unknown): () => void
}

interface LocaleSnapshot {
  active: string
}

interface LocaleService {
  register(namespace: string, locale: string, dict: Record<string, string>): () => void
  bind(namespace: string): Translate
  subscribe(listener: () => void): () => void
  getSnapshot(): LocaleSnapshot
}

type Translate = (key: string) => string

interface ReactApi {
  createElement(
    type: unknown,
    props?: Record<string, unknown> | null,
    ...children: unknown[]
  ): unknown
  useState<T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void]
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  useRef<T>(initial: T): { current: T }
}

interface Window {
  __ModuleLoader__: { load(entry: ModuleLoaderEntry): void }
}

type Style = Record<string, string | number>

const PACKAGE_ID = 'dsh-task-inbox'
const PANEL_ID = 'task-inbox'
const LOCALE_NS = 'dsh-task-inbox'
const API_PATH = '/plugins/dsh-task-inbox/api'
const TITLE_MAX_LENGTH = 200
const DESCRIPTION_MAX_LENGTH = 2000

interface Todo {
  id: string
  title: string
  description: string
  status: 'todo'
  createdAt: string
  updatedAt: string
  order: number
}

interface ApiFailure {
  code: string
  message: string
}

type MoveDirection = 'up' | 'down'

interface Banner {
  kind: 'success' | 'error'
  message: string
}

type ExecutionStrategy = 'new' | 'reuse' | 'fork'

interface ExecutionWorkspace {
  id: string
  title: string
  path: string
  available: boolean
  availability: 'ok' | 'missing-dir' | 'unknown'
}

interface ExecutionSession {
  sessionId: string
  workspaceId: string
  title?: string
  createdAt?: number
  live: boolean
  stored: boolean
  blankState: 'blank' | 'non-blank' | 'unknown'
  suitableForReuse: boolean
  suitableForFork: boolean
  unavailableReasons: string[]
  warnings: string[]
}

interface ExecutionContextSnapshot {
  available: boolean
  reason?: string
  workspaces: ExecutionWorkspace[]
  sessions: ExecutionSession[]
}

type DispatchStatus =
  | 'prepared'
  | 'session_ready'
  | 'dispatching'
  | 'accepted'
  | 'failed'
  | 'unknown'

interface ClientExecutionEvent {
  eventId: string
  kind: string
  at: string
  fromStatus?: DispatchStatus
  toStatus?: DispatchStatus
  sessionId?: string
  bindingSource?: 'client' | 'manual'
  errorCode?: string
}

interface ClientExecutionOverviewRecord {
  executionId: string
  todoId: string
  strategy: ExecutionStrategy
  workspaceId: string
  workspacePath: string
  sourceSessionId?: string
  targetSessionId?: string
  bindingSource?: 'client' | 'manual'
  status: DispatchStatus
  errorCode?: string
  createdAt: string
  updatedAt: string
  createdAtMs: number
}

interface ClientExecutionRecord {
  executionId: string
  clientRequestId: string
  requestId: string
  todoId: string
  todoTitle: string
  promptText: string
  strategy: ExecutionStrategy
  workspaceId: string
  workspacePath: string
  sourceSessionId?: string
  targetSessionId?: string
  bindingSource?: 'client' | 'manual'
  status: DispatchStatus
  errorCode?: string
  createdAt: string
  updatedAt: string
  events?: ClientExecutionEvent[]
}

interface ClientPromptResult {
  ok: boolean
  error?: { code?: string; message?: string }
}

interface ClientSessionFace {
  prompt(
    content: { type: 'text'; text: string }[],
    mode: 'queue' | 'steer',
    signal: AbortSignal | undefined,
    requestId: string,
  ): Promise<ClientPromptResult>
}

interface ClientSessionReference {
  readonly ready: Promise<void>
  readonly binding: { readonly session: ClientSessionFace }
  release(): void
}

interface ClientSessionsApi {
  create(opts: { workspaceId: string }): Promise<string>
  fork(opts: {
    sessionId: string
    allowMigration?: boolean
    onCreated?: (childId: string) => void
  }): Promise<string>
  retain(id: string, opts: { source: string }): ClientSessionReference
  refresh?(): Promise<void>
}

interface DispatchHostApi {
  intent(input: ExecutionIntentInput): Promise<ClientExecutionRecord>
  status(executionId: string): Promise<ClientExecutionRecord>
  acquire(
    executionId: string,
  ): Promise<{ execution: ClientExecutionRecord; acquired: boolean }>
  authorizePromptRetry(
    executionId: string,
  ): Promise<{ execution: ClientExecutionRecord; authorized: boolean }>
  recoverReuse(
    executionId: string,
  ): Promise<{ execution: ClientExecutionRecord; recovered: boolean }>
  sessionReady(executionId: string, sessionId: string): Promise<ClientExecutionRecord>
  dispatching(executionId: string): Promise<ClientExecutionRecord>
  result(
    executionId: string,
    outcome: 'accepted' | 'failed' | 'unknown',
    errorCode?: string,
  ): Promise<ClientExecutionRecord>
  unknown(executionId: string, errorCode?: string): Promise<ClientExecutionRecord>
  failed(executionId: string, errorCode?: string): Promise<ClientExecutionRecord>
  abandon(executionId: string): Promise<ClientExecutionRecord>
}

interface ExecutionIntentInput {
  clientRequestId: string
  todoId: string
  strategy: ExecutionStrategy
  workspaceId: string
  sourceSessionId?: string
}

interface DispatchRunResult {
  status: 'unavailable' | 'accepted' | 'failed' | 'unknown' | 'session_ready' | 'dispatching' | 'prepared' | 'error'
  execution?: ClientExecutionRecord
  sessionId?: string
  errorCode?: string
  message?: string
}

const DICTIONARIES: Record<'en' | 'zh', Record<string, string>> = {
  en: {
    'panel.label': 'Task Inbox',
    'page.title': 'Task Inbox',
    'page.subtitle':
      'Collect tasks first, then dispatch them to a workspace session for an Agent to execute.',
    'list.count': '{n} task(s)',
    'add.button': 'New task',
    'form.create.title': 'New task',
    'form.edit.title': 'Edit task',
    'form.title.label': 'Title',
    'form.title.placeholder': 'What needs doing?',
    'form.description.label': 'Description (optional)',
    'form.description.placeholder': 'Add details…',
    'form.save': 'Save',
    'form.saving': 'Saving…',
    'form.cancel': 'Cancel',
    'form.required': 'Title is required.',
    'form.tooLongTitle': 'Title is too long (max 200 characters).',
    'form.tooLongDescription': 'Description is too long (max 2000 characters).',
    'list.loading': 'Loading tasks…',
    'list.retry': 'Retry',
    'list.empty.title': 'No tasks yet',
    'list.empty.description': 'Collected tasks will appear here. Add your first task to get started.',
    'list.empty.action': 'Add a task',
    'list.createdAt': 'Created {time}',
    'list.edit': 'Edit task',
    'list.delete': 'Delete task',
    'list.moveUp': 'Move up',
    'list.moveDown': 'Move down',
    'list.confirmDelete': 'Delete this task?',
    'list.deleteConfirm': 'Delete',
    'list.deleteCancel': 'Cancel',
    'feedback.created': 'Task added.',
    'feedback.updated': 'Task saved.',
    'feedback.deleted': 'Task deleted.',
    'execution.action': 'Execute',
    'execution.panel.title': 'Configure execution',
    'execution.preview.badge': 'Preview only — nothing is sent',
    'execution.preview.notice':
      'Dispatch is not connected yet (Task 03B). This confirmation only validates the configuration; no session is created and no Agent receives the task.',
    'execution.preview.persistent':
      'Task 03A preview: choosing a workspace or session does not execute anything.',
    'execution.dispatch.intro':
      'Configuration alone does not create a Session. Only “Confirm and dispatch” starts the authorized operation.',
    'execution.dispatch.badge': 'A Session will be created/reused and the task sent',
    'execution.dispatch.previewOnly':
      'Dispatch is not available in this client; this confirmation only validates the configuration.',
    'execution.dispatch.noService': 'The Session API is unavailable; dispatch is disabled.',
    'execution.dispatch.confirm': 'Confirm and dispatch',
    'execution.dispatch.busy': 'Dispatching…',
    'execution.dispatch.accepted': 'Task accepted by the Agent. It will run in the target Session.',
    'execution.dispatch.sessionReady': 'Session saved. The task has not been accepted yet.',
    'execution.dispatch.dispatching': 'Prompt sent; waiting for Host verification.',
    'execution.dispatch.failed': 'Dispatch failed.',
    'execution.dispatch.unknown':
      'Dispatch result is unknown. Check the target Session or candidate Sessions before retrying; do not re-create or re-fork automatically.',
    'execution.dispatch.persistFailed':
      'The Session was created but its association could not be saved ({id}). Retry saving — do not create another Session.',
    'execution.dispatch.error': 'Dispatch could not be started.',
    'execution.dispatch.openSession': 'Open target Session',
    'execution.dispatch.continue': 'Continue dispatch',
    'execution.dispatch.check': 'Check status',
    'execution.dispatch.candidates': 'Find candidate Sessions',
    'execution.dispatch.bind': 'Bind this Session',
    'execution.dispatch.noCandidates':
      'No plausible candidate Sessions were found. Do not retry creating/forking automatically.',
    'execution.dispatch.retryNew': 'Start a new execution',
    'execution.dispatch.resume': 'Resume existing execution',
    'execution.dispatch.upgradeRecovery': 'Recovery first',
    'execution.dispatch.resumeRequired':
      'An unresolved execution exists for this Todo. Check status / candidates or resume it first; starting a new execution requires explicitly abandoning it.',
    'execution.dispatch.abandon': 'Abandon this execution…',
    'execution.dispatch.abandonConfirm': 'Confirm abandon (keeps any created Session)',
    'execution.dispatch.abandonWarning':
      'Abandoning only resolves this execution record. Any Session already created is kept; verify it manually. This cannot be undone.',
    'execution.dispatch.abandoned': 'Execution abandoned. You may start a new execution explicitly.',
    'execution.dispatch.manualBindingWarning':
      'Manual binding: the Host cannot prove this Session was created by this execution. Verify it yourself before continuing.',
    'execution.dispatch.resultPending':
      'The Prompt was sent, but the Host has not confirmed the result. Check status later; do not re-create the Session.',
    'execution.dispatch.leaseNotAcquired':
      'Another client already owns this dispatch attempt; no Session was created here. Refresh and use recovery actions.',
    'execution.dispatch.reuseBindingFailed':
      'The reuse target association was not saved. The source Session is known; recover the binding without creating a Session.',
    'execution.dispatch.gateBlocked': 'Dispatch is not available right now.',
    'execution.dispatch.historyLoading': 'Execution state is still loading; dispatch is disabled.',
    'execution.dispatch.historyUnavailable':
      'Execution state could not be loaded; re-check it before dispatching.',
    'execution.dispatch.capabilityUnavailable': 'Host dispatch capability is unavailable: {reason}',
    'execution.dispatch.reuseRecoverContinue': 'Recover binding and continue dispatch',
    'execution.dispatch.reuseRecoverConfirm': 'Confirm recovery and continue',
    'execution.dispatch.reuseRecoverWarning':
      'This may send a not-yet-accepted Prompt to the original Session, but it will NOT create a new Session. Continue?',
    'execution.history.title': 'Unresolved executions',
    'execution.history.count': '{n} unresolved',
    'execution.history.hint':
      'Select an execution to inspect its stored ids and recover it. Selecting does not create, fork, or send anything.',
    'execution.history.loading': 'Loading execution history…',
    'execution.history.retry': 'Retry loading history',
    'execution.history.reload': 'Re-check execution state',
    'execution.history.empty': 'No unresolved executions.',
    'execution.history.capabilityUnavailable': 'Dispatch unavailable: {reason}',
    'execution.history.selected': 'Selected',
    'execution.history.created': 'Created',
    'execution.summary.sourceSession': 'Source session',
    'execution.summary.targetSession': 'Target session',
    'execution.summary.sessionShared': 'Source / target session (reuse)',
    'execution.summary.notSaved': 'Not saved yet',
    'execution.summary.pendingSave': '(pending save)',
    'execution.dispatch.recoveryVerificationUnavailable':
      'The Session log could not be read to verify the Prompt; the execution stays unknown. Check manually before retrying.',
    'error.reuse_recovery_unavailable': 'The reuse binding could not be recovered; check the source Session manually.',
    'error.recovery_verification_unavailable': 'The Session log could not be read; manual verification is required.',
    'error.execution_unresolved': 'This Todo already has an unresolved execution. Recover or abandon it first.',
    'error.abandon_not_allowed': 'An accepted execution cannot be abandoned.',
    'error.target_session_before_intent': 'The target Session predates this execution intent.',
    'error.host_result_unavailable': 'The result could not be recorded yet; verify it with status/candidates.',
    'error.dispatch_lease_not_acquired': 'Another client owns this dispatch attempt.',
    'error.prompt_retry_not_authorized': 'A Prompt retry was not authorized; verify manually.',
    'execution.dispatch.candidateHint':
      'Choose only if you can confirm this Session belongs to this task; binding is manual.',
    'execution.dispatch.latest': 'Existing execution for this task',
    'execution.dispatch.resumeHint':
      'An earlier attempt was not accepted. You can safely continue from the saved Session; no new Session will be created.',
    'execution.dispatch.agentHint': 'Acceptance means DSH admitted the prompt; completion is tracked in Task 04.',
    'execution.status.prepared': 'Prepared',
    'execution.status.session_ready': 'Session saved',
    'execution.status.dispatching': 'Waiting for acceptance',
    'execution.status.accepted': 'Accepted',
    'execution.status.failed': 'Failed',
    'execution.status.unknown': 'Unknown',
    'error.execution_conflict': 'This execution request conflicts with an existing one.',
    'error.execution_not_found': 'The execution record was not found.',
    'error.invalid_transition': 'This execution is not in a state that allows this action.',
    'error.workspace_unavailable': 'The selected workspace is unavailable.',
    'error.source_session_required': 'Select a source session.',
    'error.source_session_not_found': 'The source session was not found.',
    'error.source_session_wrong_workspace': 'The source session does not belong to this workspace.',
    'error.source_session_blank': 'Blank sessions cannot be reused or forked.',
    'error.source_session_state_unknown': 'The source session state could not be confirmed.',
    'error.target_session_not_found': 'The target session was not found.',
    'error.target_session_wrong_workspace': 'The target session does not belong to this workspace.',
    'error.target_session_not_blank': 'The new session is no longer blank.',
    'error.candidate_not_found': 'That session is not a valid candidate.',
    'error.verification_unavailable': 'Acceptance could not be verified yet.',
    'execution.todo.label': 'Task',
    'execution.workspace.label': 'Workspace',
    'execution.workspace.placeholder': 'Select a workspace',
    'execution.workspace.unavailable': 'directory unavailable',
    'execution.workspace.empty': 'No registered workspaces.',
    'execution.strategy.label': 'Session strategy',
    'execution.strategy.new': 'New session',
    'execution.strategy.reuse': 'Reuse session',
    'execution.strategy.fork': 'Fork session',
    'execution.strategy.new.hint': 'Create a new session in this workspace. Dispatch arrives in Task 03B.',
    'execution.strategy.reuse.hint': 'Append the task to an existing non-blank session.',
    'execution.strategy.fork.hint': 'Fork from an existing session and keep its context.',
    'execution.session.label': 'Source session',
    'execution.session.placeholder': 'Select a session',
    'execution.session.empty': 'No sessions in this workspace.',
    'execution.session.blank': 'blank',
    'execution.session.stateUnknown': 'state unknown',
    'execution.session.notFound': 'not found',
    'execution.session.live': 'live',
    'execution.session.noneSuitable': 'No session in this workspace is suitable for this strategy.',
    'execution.session.unavailableCount':
      '{n} session(s) in this workspace are not suitable for this strategy.',
    'execution.session.unknownCount':
      '{n} session(s) whose state could not be confirmed are not offered (conservative).',
    'execution.session.unknownHint':
      'A session is only offered when its stored log can be read and shows a started turn.',
    'execution.session.warningArchive':
      'Archive state is validated by the Host at dispatch time.',
    'execution.session.warningFork':
      'Fork needs a session with a completed turn; the Host validates it at dispatch time.',
    'execution.summary.title': 'Summary',
    'execution.summary.todo': 'Task',
    'execution.summary.workspace': 'Workspace',
    'execution.summary.strategy': 'Strategy',
    'execution.summary.session': 'Source session',
    'execution.summary.status': 'Status',
    'execution.summary.newSession': 'New session',
    'execution.summary.unset': 'Not selected',
    'execution.confirm': 'Confirm configuration (preview)',
    'execution.back': 'Back to tasks',
    'execution.loading': 'Loading workspaces and sessions…',
    'execution.retry': 'Retry',
    'execution.error.load': 'Execution configuration could not be loaded.',
    'execution.error.workspaceRequired': 'Select a workspace first.',
    'execution.error.workspaceUnavailable': 'The selected workspace is unavailable.',
    'execution.error.sessionRequired': 'Select a source session.',
    'execution.error.sessionUnsuitable': 'The selected session is not suitable for this strategy.',
    'execution.titleUnknown': 'Untitled session',
    'workbench.stats.total': 'All tasks',
    'workbench.stats.undispatched': 'Not dispatched',
    'workbench.stats.unresolved': 'Needs attention',
    'workbench.stats.accepted': 'Dispatched',
    'workbench.search.placeholder': 'Search tasks…',
    'workbench.filter.status': 'Status',
    'workbench.filter.all': 'All statuses',
    'workbench.filter.undispatched': 'Not dispatched',
    'workbench.filter.unresolved': 'Needs attention',
    'workbench.filter.accepted': 'Dispatched',
    'workbench.filter.workspace': 'Workspace',
    'workbench.filter.allWorkspaces': 'All workspaces',
    'workbench.filter.unassigned': 'Unassigned',
    'workbench.filter.strategy': 'Strategy',
    'workbench.filter.allStrategies': 'All strategies',
    'workbench.sort.label': 'Sort',
    'workbench.sort.manual': 'Manual order',
    'workbench.sort.recent': 'Recently updated',
    'workbench.sort.created': 'Recently created',
    'workbench.list.title': 'Tasks',
    'workbench.list.count': '{visible} of {total} tasks',
    'workbench.list.noResults': 'No tasks match these filters.',
    'workbench.list.clearFilters': 'Clear filters',
    'workbench.list.selectHint': 'Select a task to inspect its details.',
    'workbench.detail.title': 'Task details',
    'workbench.detail.selectHint': 'Select a task to see its details and execution history.',
    'workbench.detail.execute': 'Configure execution',
    'workbench.detail.edit': 'Edit',
    'workbench.detail.delete': 'Delete',
    'workbench.detail.latestExecution': 'Latest execution',
    'workbench.detail.noExecution': 'This task has not been dispatched yet.',
    'workbench.detail.history': 'Execution history',
    'workbench.detail.historyLoading': 'Loading execution history…',
    'workbench.detail.historyError': 'Execution history could not be loaded.',
    'workbench.detail.retry': 'Retry',
    'workbench.detail.noEvents': 'No event details were recorded for this legacy execution.',
    'workbench.detail.openExecution': 'Open recovery controls',
    'workbench.detail.createdAt': 'Created',
    'workbench.detail.updatedAt': 'Updated',
    'workbench.detail.workspace': 'Workspace',
    'workbench.detail.strategy': 'Strategy',
    'workbench.detail.session': 'Session',
    'workbench.detail.status': 'Status',
    'workbench.detail.unassigned': 'Unassigned workspace',
    'workbench.event.intent_created': 'Execution intent created',
    'workbench.event.dispatch_started': 'Dispatch lease acquired',
    'workbench.event.prompt_dispatch_started': 'Prompt dispatch started',
    'workbench.event.prompt_retry_started': 'Authorized Prompt retry started',
    'workbench.event.session_ready': 'Session is ready',
    'workbench.event.session_bound': 'Target Session associated',
    'workbench.event.prompt_accepted': 'Prompt acceptance verified',
    'workbench.event.prompt_failed': 'Prompt dispatch failed',
    'workbench.event.outcome_unknown': 'Outcome could not be confirmed',
    'workbench.event.recovered': 'Execution recovered by Host verification',
    'workbench.event.abandoned': 'Execution abandoned; created Session kept',
    'workbench.event.status_changed': 'Execution status changed',
    'workbench.status.prepared': 'Prepared',
    'workbench.status.session_ready': 'Session ready',
    'workbench.status.dispatching': 'Dispatching',
    'workbench.status.accepted': 'Accepted',
    'workbench.status.failed': 'Failed',
    'workbench.status.unknown': 'Unknown',
    'error.execution_unavailable': 'Execution configuration is not available.',
    'banner.dismiss': 'Dismiss',
    'error.network': 'Cannot reach the Task Inbox service.',
    'error.unauthorized': 'Your session is not authorized. Reload the page and try again.',
    'error.invalid_title': 'Please enter a title.',
    'error.invalid_description': 'The description is not valid.',
    'error.invalid_payload': 'The request was rejected. Reload the page and try again.',
    'error.not_found': 'This task no longer exists.',
    'error.storage_failed': 'The change was not saved.',
    'error.storage_uncertain':
      'The save result could not be confirmed. Restart or reload DSH, then check the list before trying again.',
    'error.internal_error': 'The Task Inbox service failed unexpectedly.',
    'error.unknown': 'Something went wrong.',
    'error.loadFailed': 'Tasks could not be loaded.',
  },
  zh: {
    'panel.label': '待办箱',
    'page.title': '待办箱',
    'page.subtitle': '先收集待办，执行时再选择工作区与会话，由 Agent 完成并追踪结果。',
    'list.count': '共 {n} 条',
    'add.button': '新增待办',
    'form.create.title': '新增待办',
    'form.edit.title': '编辑待办',
    'form.title.label': '标题',
    'form.title.placeholder': '要做什么？',
    'form.description.label': '描述（可选）',
    'form.description.placeholder': '补充细节…',
    'form.save': '保存',
    'form.saving': '保存中…',
    'form.cancel': '取消',
    'form.required': '标题不能为空。',
    'form.tooLongTitle': '标题过长（最多 200 个字符）。',
    'form.tooLongDescription': '描述过长（最多 2000 个字符）。',
    'list.loading': '正在加载待办…',
    'list.retry': '重试',
    'list.empty.title': '暂无待办',
    'list.empty.description': '收集的待办会显示在这里，先添加第一条吧。',
    'list.empty.action': '添加待办',
    'list.createdAt': '创建于 {time}',
    'list.edit': '编辑待办',
    'list.delete': '删除待办',
    'list.moveUp': '上移',
    'list.moveDown': '下移',
    'list.confirmDelete': '确认删除这条待办？',
    'list.deleteConfirm': '删除',
    'list.deleteCancel': '取消',
    'feedback.created': '已添加待办。',
    'feedback.updated': '已保存修改。',
    'feedback.deleted': '已删除待办。',
    'execution.action': '执行',
    'execution.panel.title': '配置执行',
    'execution.preview.badge': '仅预览——不会发送任务',
    'execution.preview.notice':
      '派发尚未接通（Task 03B）。本次确认仅校验配置，不会创建会话，也不会向 Agent 发送任务。',
    'execution.preview.persistent': 'Task 03A 预览：选择工作区或会话不会执行任何操作。',
    'execution.dispatch.intro':
      '仅配置不会创建会话；只有点击“确认并派发”才会执行受权操作。',
    'execution.dispatch.badge': '将创建/复用会话并发送任务',
    'execution.dispatch.previewOnly': '当前客户端无法派发；本次确认仅校验配置。',
    'execution.dispatch.noService': 'Session API 不可用，派发已禁用。',
    'execution.dispatch.confirm': '确认并派发',
    'execution.dispatch.busy': '派发中…',
    'execution.dispatch.accepted': 'Agent 已接受任务，将在目标会话中执行。',
    'execution.dispatch.sessionReady': '会话已保存，但任务尚未被接受。',
    'execution.dispatch.dispatching': 'Prompt 已发送，等待 Host 验证。',
    'execution.dispatch.failed': '派发失败。',
    'execution.dispatch.unknown':
      '派发结果不确定。请检查目标会话或候选会话后再决定；不要自动重新创建/Fork。',
    'execution.dispatch.persistFailed':
      '会话已创建，但关联保存失败（{id}）。请重试保存——不要再次创建会话。',
    'execution.dispatch.error': '无法开始派发。',
    'execution.dispatch.openSession': '打开目标会话',
    'execution.dispatch.continue': '继续派发',
    'execution.dispatch.check': '检查状态',
    'execution.dispatch.candidates': '查找候选会话',
    'execution.dispatch.bind': '绑定该会话',
    'execution.dispatch.noCandidates': '没有找到可信的候选会话。请勿自动重试创建/Fork。',
    'execution.dispatch.retryNew': '开始新的执行',
    'execution.dispatch.resume': '恢复已有执行',
    'execution.dispatch.upgradeRecovery': '优先恢复',
    'execution.dispatch.resumeRequired':
      '该待办存在未解决的执行。请先检查状态/候选会话或恢复它；主动发起新执行需要先明确放弃旧执行。',
    'execution.dispatch.abandon': '放弃此执行…',
    'execution.dispatch.abandonConfirm': '确认放弃（保留已创建会话）',
    'execution.dispatch.abandonWarning':
      '放弃只会结束此执行记录。已创建的会话会被保留，请自行核查；该操作不可撤销。',
    'execution.dispatch.abandoned': '执行已放弃；你可以明确发起新的执行。',
    'execution.dispatch.manualBindingWarning':
      '手动绑定：Host 无法证明该会话由本次执行创建，请自行确认后再继续。',
    'execution.dispatch.resultPending':
      'Prompt 已发送，但 Host 尚未确认结果。请稍后检查状态；不要重新创建会话。',
    'execution.dispatch.leaseNotAcquired':
      '另一个客户端已持有本次派发执行权，此处没有创建会话。请刷新并使用恢复操作。',
    'execution.dispatch.reuseBindingFailed':
      '复用目标关联保存失败。来源会话已知，可恢复绑定，不会创建新会话。',
    'execution.dispatch.gateBlocked': '当前条件不满足，暂不能派发。',
    'execution.dispatch.historyLoading': '执行状态尚未加载完成，暂时不能派发。',
    'execution.dispatch.historyUnavailable': '执行状态无法加载，请重新检查后再派发。',
    'execution.dispatch.capabilityUnavailable': 'Host 派发能力不可用：{reason}',
    'execution.dispatch.reuseRecoverContinue': '恢复绑定并继续派发',
    'execution.dispatch.reuseRecoverConfirm': '确认恢复并继续',
    'execution.dispatch.reuseRecoverWarning':
      '该操作可能向原 Session 发送尚未被接收的 Prompt，但不会创建新会话。是否继续？',
    'execution.history.title': '历史未解决执行',
    'execution.history.count': '{n} 条未解决',
    'execution.history.hint':
      '选择一条执行查看其保存的 ID 并恢复；选择不会创建、Fork 或发送任何内容。',
    'execution.history.loading': '正在加载执行历史…',
    'execution.history.retry': '重新加载历史',
    'execution.history.reload': '重新检查执行状态',
    'execution.history.empty': '暂无未解决执行。',
    'execution.history.capabilityUnavailable': '派发能力不可用：{reason}',
    'execution.history.selected': '已选择',
    'execution.history.created': '创建时间',
    'execution.summary.sourceSession': '来源会话',
    'execution.summary.targetSession': '目标会话',
    'execution.summary.sessionShared': '来源 / 目标会话（复用）',
    'execution.summary.notSaved': '尚未保存',
    'execution.summary.pendingSave': '（待保存）',
    'execution.dispatch.recoveryVerificationUnavailable':
      'Session 日志无法读取以核验 Prompt；执行保持 unknown，请人工检查后再决定。',
    'error.reuse_recovery_unavailable': '复用绑定恢复失败；请人工检查来源会话。',
    'error.recovery_verification_unavailable': 'Session 日志无法读取，需要人工核实。',
    'error.execution_unresolved': '该待办已有未解决的执行，请先恢复或放弃。',
    'error.abandon_not_allowed': '已接受的执行不能放弃。',
    'error.target_session_before_intent': '目标会话早于本次执行意图。',
    'error.host_result_unavailable': '结果暂时无法记录，请用“检查状态/候选会话”核实。',
    'error.dispatch_lease_not_acquired': '另一个客户端持有本次派发执行权。',
    'error.prompt_retry_not_authorized': '本次 Prompt 重试未获授权，请手动核实。',
    'execution.dispatch.candidateHint': '只有你确认该会话属于本任务时才绑定；绑定必须手动进行。',
    'execution.dispatch.latest': '该任务的已有执行',
    'execution.dispatch.resumeHint':
      '之前的执行尚未被接受。你可以从已保存的会话安全继续；不会创建新会话。',
    'execution.dispatch.agentHint': '接受仅表示 DSH 已接收 Prompt；执行完成状态在 Task 04 追踪。',
    'execution.status.prepared': '已准备',
    'execution.status.session_ready': '会话已保存',
    'execution.status.dispatching': '等待接受',
    'execution.status.accepted': '已接受',
    'execution.status.failed': '失败',
    'execution.status.unknown': '不确定',
    'error.execution_conflict': '该执行请求与已有记录冲突。',
    'error.execution_not_found': '未找到执行记录。',
    'error.invalid_transition': '当前执行状态不允许该操作。',
    'error.workspace_unavailable': '所选工作区不可用。',
    'error.source_session_required': '请选择来源会话。',
    'error.source_session_not_found': '未找到来源会话。',
    'error.source_session_wrong_workspace': '来源会话不属于该工作区。',
    'error.source_session_blank': '空白会话不能用于复用或 Fork。',
    'error.source_session_state_unknown': '来源会话状态无法确认。',
    'error.target_session_not_found': '未找到目标会话。',
    'error.target_session_wrong_workspace': '目标会话不属于该工作区。',
    'error.target_session_not_blank': '新会话已不再是空白会话。',
    'error.candidate_not_found': '该会话不是有效候选。',
    'error.verification_unavailable': '暂时无法验证是否已被接受。',
    'execution.todo.label': '待办',
    'execution.workspace.label': '工作区',
    'execution.workspace.placeholder': '选择工作区',
    'execution.workspace.unavailable': '目录不可用',
    'execution.workspace.empty': '还没有已注册的工作区。',
    'execution.strategy.label': '会话策略',
    'execution.strategy.new': '新建会话',
    'execution.strategy.reuse': '复用会话',
    'execution.strategy.fork': 'Fork 会话',
    'execution.strategy.new.hint': '在该工作区创建新会话；派发将在 Task 03B 接通。',
    'execution.strategy.reuse.hint': '把待办追加到已有的非空白会话。',
    'execution.strategy.fork.hint': '从已有会话 Fork，并保留其上下文。',
    'execution.session.label': '来源会话',
    'execution.session.placeholder': '选择会话',
    'execution.session.empty': '该工作区下没有会话。',
    'execution.session.blank': '空白',
    'execution.session.stateUnknown': '状态未知',
    'execution.session.notFound': '不存在',
    'execution.session.live': '活跃',
    'execution.session.noneSuitable': '该工作区下没有适合此策略的会话。',
    'execution.session.unavailableCount': '该工作区下另有 {n} 个会话不适合此策略。',
    'execution.session.unknownCount': '该工作区下另有 {n} 个会话状态无法确认，已保守排除。',
    'execution.session.unknownHint': '只有能读取存储日志且确认已开始轮次的会话才会作为候选提供。',
    'execution.session.warningArchive': '归档状态将在派发时由 Host 校验。',
    'execution.session.warningFork': 'Fork 需要包含已完成轮次的会话；派发时由 Host 校验。',
    'execution.summary.title': '摘要',
    'execution.summary.todo': '待办',
    'execution.summary.workspace': '工作区',
    'execution.summary.strategy': '策略',
    'execution.summary.session': '来源会话',
    'execution.summary.status': '状态',
    'execution.summary.newSession': '新建会话',
    'execution.summary.unset': '未选择',
    'execution.confirm': '确认配置（仅预览）',
    'execution.back': '返回待办列表',
    'execution.loading': '正在加载工作区与会话…',
    'execution.retry': '重试',
    'execution.error.load': '执行配置加载失败。',
    'execution.error.workspaceRequired': '请先选择工作区。',
    'execution.error.workspaceUnavailable': '所选工作区不可用。',
    'execution.error.sessionRequired': '请选择来源会话。',
    'execution.error.sessionUnsuitable': '所选会话不适合该策略。',
    'execution.titleUnknown': '未命名会话',
    'workbench.stats.total': '全部待办',
    'workbench.stats.undispatched': '未派发',
    'workbench.stats.unresolved': '待处理',
    'workbench.stats.accepted': '已派发',
    'workbench.search.placeholder': '搜索待办…',
    'workbench.filter.status': '状态',
    'workbench.filter.all': '全部状态',
    'workbench.filter.undispatched': '未派发',
    'workbench.filter.unresolved': '待处理',
    'workbench.filter.accepted': '已派发',
    'workbench.filter.workspace': '工作区',
    'workbench.filter.allWorkspaces': '全部工作区',
    'workbench.filter.unassigned': '未分配',
    'workbench.filter.strategy': '策略',
    'workbench.filter.allStrategies': '全部策略',
    'workbench.sort.label': '排序',
    'workbench.sort.manual': '手动顺序',
    'workbench.sort.recent': '最近更新',
    'workbench.sort.created': '最近创建',
    'workbench.list.title': '待办',
    'workbench.list.count': '{visible} / {total} 条待办',
    'workbench.list.noResults': '没有符合当前筛选条件的待办。',
    'workbench.list.clearFilters': '清除筛选',
    'workbench.list.selectHint': '选择一条待办查看详情。',
    'workbench.detail.title': '待办详情',
    'workbench.detail.selectHint': '选择一条待办，查看完整内容和执行历史。',
    'workbench.detail.execute': '配置执行',
    'workbench.detail.edit': '编辑',
    'workbench.detail.delete': '删除',
    'workbench.detail.latestExecution': '最近一次执行',
    'workbench.detail.noExecution': '这条待办还没有派发过。',
    'workbench.detail.history': '执行历史',
    'workbench.detail.historyLoading': '正在加载执行历史…',
    'workbench.detail.historyError': '执行历史加载失败。',
    'workbench.detail.retry': '重试',
    'workbench.detail.noEvents': '这条旧执行记录没有保存事件明细。',
    'workbench.detail.openExecution': '打开恢复操作',
    'workbench.detail.createdAt': '创建时间',
    'workbench.detail.updatedAt': '更新时间',
    'workbench.detail.workspace': '工作区',
    'workbench.detail.strategy': '策略',
    'workbench.detail.session': '会话',
    'workbench.detail.status': '状态',
    'workbench.detail.unassigned': '未分配工作区',
    'workbench.event.intent_created': '创建执行意图',
    'workbench.event.dispatch_started': '取得派发执行权',
    'workbench.event.prompt_dispatch_started': '开始派发 Prompt',
    'workbench.event.prompt_retry_started': '开始已授权的 Prompt 重试',
    'workbench.event.session_ready': '会话已就绪',
    'workbench.event.session_bound': '已关联目标会话',
    'workbench.event.prompt_accepted': '已核验 Prompt 接受结果',
    'workbench.event.prompt_failed': 'Prompt 派发失败',
    'workbench.event.outcome_unknown': '暂时无法确认执行结果',
    'workbench.event.recovered': 'Host 核验后恢复执行状态',
    'workbench.event.abandoned': '执行已放弃；已创建会话保留',
    'workbench.event.status_changed': '执行状态变更',
    'workbench.status.prepared': '已准备',
    'workbench.status.session_ready': '会话已就绪',
    'workbench.status.dispatching': '派发中',
    'workbench.status.accepted': '已接受',
    'workbench.status.failed': '失败',
    'workbench.status.unknown': '待核验',
    'error.execution_unavailable': '执行配置暂不可用。',
    'banner.dismiss': '关闭',
    'error.network': '无法连接待办箱服务。',
    'error.unauthorized': '当前会话未授权，请刷新页面后重试。',
    'error.invalid_title': '请输入标题。',
    'error.invalid_description': '描述内容不合法。',
    'error.invalid_payload': '请求被拒绝，请刷新页面后重试。',
    'error.not_found': '这条待办已不存在。',
    'error.storage_failed': '保存失败，修改未保存。',
    'error.storage_uncertain': '保存结果暂时无法确认。请重启或重载 DSH，确认列表内容后再试。',
    'error.internal_error': '待办箱服务出现异常。',
    'error.unknown': '出现未知错误。',
    'error.loadFailed': '待办加载失败。',
  },
}

const ICON_PLUS = ['M12 5v14', 'M5 12h14']
const ICON_UP = ['M12 19V5', 'M6 11l6-6 6 6']
const ICON_DOWN = ['M12 5v14', 'M6 13l6 6 6-6']
const ICON_EDIT = ['M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z', 'M13.5 6.5l4 4']
const ICON_TRASH = ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3']
const ICON_X = ['M6 6l12 12', 'M18 6L6 18']
const ICON_RETRY = ['M4 12a8 8 0 1 0 2.4-5.7', 'M4 4v5h5']
const ICON_PLAY = ['M8 5l11 7-11 7z']
const ICON_BACK = ['M19 12H5', 'M12 19l-7-7 7-7']

const STYLES: Record<string, Style> = {
  page: {
    height: '100%',
    boxSizing: 'border-box',
    padding: '32px 24px 48px',
    overflowY: 'auto',
    background: 'var(--dsw-alias-bg-base)',
    color: 'var(--dsw-alias-label-primary)',
  },
  frame: { maxWidth: '720px', margin: '0 auto' },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '16px',
    flexWrap: 'wrap',
    marginBottom: '20px',
  },
  headerText: { flex: '1 1 320px', minWidth: 0 },
  title: { margin: 0, fontSize: '20px', fontWeight: 600, lineHeight: 1.3 },
  subtitle: {
    margin: '6px 0 0',
    fontSize: '13px',
    lineHeight: 1.6,
    color: 'var(--dsw-alias-label-secondary)',
  },
  primaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 14px',
    borderRadius: '8px',
    border: '1px solid var(--dsw-alias-brand-primary)',
    background: 'var(--dsw-alias-brand-primary)',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  secondaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '7px 12px',
    borderRadius: '8px',
    border: '1px solid var(--dsw-alias-border-l1)',
    background: 'var(--dsw-alias-bg-layer-2)',
    color: 'var(--dsw-alias-label-primary)',
    fontSize: '13px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  dangerButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '7px 12px',
    borderRadius: '8px',
    border: '1px solid var(--dsw-alias-state-error-primary)',
    background: 'transparent',
    color: 'var(--dsw-alias-state-error-primary)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  card: {
    boxSizing: 'border-box',
    border: '1px solid var(--dsw-alias-border-l1)',
    borderRadius: '12px',
    background: 'var(--dsw-alias-bg-layer-1)',
    padding: '20px',
    marginBottom: '16px',
  },
  cardTitle: { margin: '0 0 14px', fontSize: '15px', fontWeight: 600 },
  label: { display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: 600 },
  input: {
    boxSizing: 'border-box',
    width: '100%',
    padding: '8px 10px',
    borderRadius: '8px',
    border: '1px solid var(--dsw-alias-border-l1)',
    background: 'var(--dsw-alias-bg-base)',
    color: 'var(--dsw-alias-label-primary)',
    fontSize: '13px',
    lineHeight: 1.5,
  },
  formActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: '16px',
  },
  errorText: {
    margin: '8px 0 0',
    fontSize: '12px',
    color: 'var(--dsw-alias-state-error-primary)',
  },
  successBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '8px 12px',
    marginBottom: '12px',
    borderLeft: '3px solid var(--dsw-alias-state-success-primary)',
    borderRadius: '8px',
    background: 'var(--dsw-alias-bg-layer-2)',
    fontSize: '13px',
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '8px 12px',
    marginBottom: '12px',
    borderLeft: '3px solid var(--dsw-alias-state-error-primary)',
    borderRadius: '8px',
    background: 'var(--dsw-alias-bg-layer-2)',
    fontSize: '13px',
  },
  bannerDismiss: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '22px',
    padding: 0,
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary)',
    cursor: 'pointer',
    flexShrink: 0,
  },
  list: {
    boxSizing: 'border-box',
    border: '1px solid var(--dsw-alias-border-l1)',
    borderRadius: '12px',
    background: 'var(--dsw-alias-bg-layer-1)',
    overflow: 'hidden',
  },
  count: {
    margin: '0 0 8px',
    fontSize: '12px',
    color: 'var(--dsw-alias-label-secondary)',
  },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '14px 16px',
    borderTop: '1px solid var(--dsw-alias-border-l1)',
  },
  rowMain: { flex: '1 1 auto', minWidth: 0 },
  rowTitle: { fontSize: '14px', fontWeight: 600, lineHeight: 1.45, wordBreak: 'break-word' },
  rowDescription: {
    marginTop: '4px',
    fontSize: '13px',
    lineHeight: 1.55,
    color: 'var(--dsw-alias-label-secondary)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  rowMeta: {
    marginTop: '6px',
    fontSize: '12px',
    color: 'var(--dsw-alias-label-secondary)',
  },
  rowActions: { display: 'flex', alignItems: 'flex-start', gap: '4px', flexShrink: 0 },
  iconButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    padding: 0,
    border: '1px solid var(--dsw-alias-border-l1)',
    borderRadius: '6px',
    background: 'var(--dsw-alias-bg-layer-2)',
    color: 'var(--dsw-alias-label-secondary)',
    cursor: 'pointer',
  },
  confirmText: {
    alignSelf: 'center',
    fontSize: '12px',
    color: 'var(--dsw-alias-label-secondary)',
    whiteSpace: 'nowrap',
  },
  emptyCard: {
    boxSizing: 'border-box',
    maxWidth: '560px',
    margin: '32px auto 0',
    padding: '40px 32px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    border: '1px solid var(--dsw-alias-border-l1)',
    borderRadius: '12px',
    background: 'var(--dsw-alias-bg-layer-1)',
  },
  emptyIcon: {
    width: '64px',
    height: '64px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    background: 'var(--dsw-alias-bg-layer-2)',
  },
  emptyTitle: { margin: '16px 0 0', fontSize: '16px', fontWeight: 600 },
  emptyText: {
    margin: '8px 0 0',
    maxWidth: '360px',
    fontSize: '13px',
    lineHeight: 1.6,
    color: 'var(--dsw-alias-label-secondary)',
  },
  muted: {
    margin: 0,
    fontSize: '13px',
    color: 'var(--dsw-alias-label-secondary)',
  },
  executionPanel: {
    boxSizing: 'border-box',
    border: '1px solid var(--dsw-alias-border-l1)',
    borderRadius: '12px',
    background: 'var(--dsw-alias-bg-layer-1)',
    padding: '20px',
    marginBottom: '16px',
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap',
  },
  executionBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    borderRadius: '999px',
    background: 'var(--dsw-alias-bg-layer-2)',
    color: 'var(--dsw-alias-state-warn-primary)',
    fontSize: '11px',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  sectionBox: {
    marginTop: '14px',
    padding: '12px',
    borderRadius: '8px',
    background: 'var(--dsw-alias-bg-layer-2)',
  },
  sectionLabel: { margin: '16px 0 6px', fontSize: '12px', fontWeight: 600 },
  hintText: {
    margin: '6px 0 0',
    fontSize: '12px',
    lineHeight: 1.5,
    color: 'var(--dsw-alias-label-secondary)',
  },
  strategyGroup: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  strategyButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '7px 12px',
    borderRadius: '8px',
    border: '1px solid var(--dsw-alias-border-l1)',
    background: 'var(--dsw-alias-bg-layer-2)',
    color: 'var(--dsw-alias-label-primary)',
    fontSize: '13px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  strategyButtonActive: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '7px 12px',
    borderRadius: '8px',
    border: '1px solid var(--dsw-alias-brand-primary)',
    background: 'var(--dsw-alias-bg-layer-2)',
    color: 'var(--dsw-alias-brand-primary)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  summaryBox: {
    marginTop: '16px',
    padding: '12px',
    borderRadius: '8px',
    background: 'var(--dsw-alias-bg-layer-2)',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    fontSize: '13px',
  },
  summaryRow: { display: 'flex', gap: '12px', justifyContent: 'space-between' },
  historyList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginTop: '10px',
  },
  historyHeader: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: '8px',
    flexWrap: 'wrap',
  },
  historyItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    width: '100%',
    textAlign: 'left',
    padding: '10px 12px',
    border: '1px solid var(--dsw-alias-border-l1)',
    borderRadius: '8px',
    background: 'var(--dsw-alias-bg-layer-2)',
    color: 'var(--dsw-alias-label-primary)',
    cursor: 'pointer',
    font: 'inherit',
  },
  historyItemSelected: {
    borderColor: 'var(--dsw-alias-brand-primary)',
    boxShadow: 'inset 0 0 0 1px var(--dsw-alias-brand-primary)',
  },
  historyRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
    fontSize: '12px',
  },
  historyId: {
    fontWeight: 600,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },
  historyBadge: {
    fontSize: '11px',
    padding: '1px 6px',
    borderRadius: '999px',
    background: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-secondary)',
  },
  historyMeta: {
    fontSize: '12px',
    color: 'var(--dsw-alias-label-secondary)',
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
  },
  summaryKey: {
    color: 'var(--dsw-alias-label-secondary)',
    flexShrink: 0,
  },
  summaryValue: { textAlign: 'right', wordBreak: 'break-word' },
  previewNotice: {
    marginTop: '16px',
    padding: '10px 12px',
    borderLeft: '3px solid var(--dsw-alias-state-warn-primary)',
    borderRadius: '8px',
    background: 'var(--dsw-alias-bg-layer-2)',
    fontSize: '13px',
    lineHeight: 1.5,
  },
}

class ClientApiError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ClientApiError'
    this.code = code
  }
}

async function callApi<T>(operation: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(API_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(operation),
      signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new ClientApiError('network', 'Network request failed.')
  }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  const envelope = payload as
    | { ok?: unknown; data?: unknown; error?: Partial<ApiFailure> }
    | null
  if (envelope !== null && typeof envelope === 'object' && envelope.ok === true) {
    return envelope.data as T
  }
  if (envelope !== null && typeof envelope === 'object' && envelope.ok === false) {
    const failure = envelope.error
    const code = typeof failure?.code === 'string' ? failure.code : 'unknown'
    const message = typeof failure?.message === 'string' ? failure.message : 'Request failed.'
    throw new ClientApiError(code, message)
  }
  if (response.status === 401 || response.status === 403) {
    throw new ClientApiError('unauthorized', 'Authentication required.')
  }
  throw new ClientApiError('network', `Request failed (${response.status}).`)
}

const WORKBENCH_CSS = `
.dti-workbench{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,380px);gap:18px;align-items:start;min-width:0}
.dti-workbench-main{min-width:0}
.dti-stat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0 0 16px}
.dti-stat{min-width:0;padding:13px 15px;border:0;border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-panel)}
.dti-stat-label{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
.dti-stat-value{margin-top:5px;font-size:23px;font-weight:500;line-height:1.25;font-variant-numeric:tabular-nums}
.dti-toolbar{display:grid;grid-template-columns:minmax(180px,1fr) repeat(4,minmax(112px,auto));gap:8px;margin:0 0 13px;min-width:0}
.dti-control{box-sizing:border-box;width:100%;min-width:0;min-height:36px;padding:7px 10px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
.dti-control:disabled{opacity:.55;cursor:not-allowed}
.dti-task-list{overflow:hidden;border:0;border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-panel)}
.dti-task-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:13px 14px;border-bottom:.5px solid var(--dsw-alias-border-l1);min-width:0}
.dti-task-row:last-child{border-bottom:0}
.dti-task-row.is-selected{background:var(--dsw-alias-bg-layer-2);box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary)}
.dti-task-select{display:flex;flex-direction:column;gap:4px;min-width:0;width:100%;padding:0;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}
.dti-task-title{font-size:14px;font-weight:500;line-height:1.45;overflow-wrap:anywhere}
.dti-task-description{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere}
.dti-task-meta{display:flex;flex-wrap:wrap;gap:4px 11px;margin-top:2px;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
.dti-task-actions{display:flex;align-items:center;justify-content:flex-end;gap:4px;flex-shrink:0}
.dti-status{display:inline-flex;align-items:center;min-height:19px;padding:2px 7px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:10px;line-height:1.3;font-weight:500;white-space:nowrap}
.dti-status-accepted{color:var(--dsw-alias-state-success-primary)}
.dti-status-failed{color:var(--dsw-alias-state-error-primary)}
.dti-status-unknown{color:var(--dsw-alias-state-warn-primary)}
.dti-status-prepared,.dti-status-session_ready,.dti-status-dispatching{color:var(--dsw-alias-brand-primary)}
.dti-status-undispatched{color:var(--dsw-alias-label-secondary)}
.dti-detail-pane{position:sticky;top:12px;box-sizing:border-box;min-width:0;max-height:calc(100vh - 24px);overflow:auto;padding:17px;border:0;border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-panel)}
.dti-detail-header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.dti-detail-title{margin:0;font-size:16px;font-weight:500;line-height:1.4;overflow-wrap:anywhere}
.dti-detail-description{margin:9px 0 0;font-size:13px;line-height:1.65;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere}
.dti-detail-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:14px}
.dti-detail-section{margin-top:17px;padding-top:14px;border-top:.5px solid var(--dsw-alias-border-l1)}
.dti-detail-section-title{margin:0 0 10px;font-size:12px;font-weight:500}
.dti-detail-meta{display:flex;flex-direction:column;gap:8px;font-size:12px;line-height:1.5}.dti-detail-meta-pair{display:grid;grid-template-columns:minmax(76px,.7fr) minmax(0,1.3fr);gap:8px 12px;min-width:0}
.dti-detail-key{color:var(--dsw-alias-label-secondary)}
.dti-detail-value{min-width:0;overflow-wrap:anywhere}
.dti-history-item{margin-top:8px;padding:10px 11px;border-radius:9px;background:var(--dsw-alias-bg-layer-2)}
.dti-history-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dti-history-id{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.dti-history-events{display:flex;flex-direction:column;gap:9px;margin:11px 0 0;padding-left:2px}
.dti-history-event{display:grid;grid-template-columns:9px minmax(0,1fr);gap:8px;align-items:start}
.dti-history-dot{width:7px;height:7px;margin-top:5px;border-radius:50%;background:var(--dsw-alias-brand-primary)}
.dti-history-event-title{font-size:11px;line-height:1.4}
.dti-history-event-time{margin-top:2px;font-size:10px;color:var(--dsw-alias-label-secondary)}
.dti-history-footer{display:flex;justify-content:flex-end;margin-top:9px}
.dti-overview-error{margin:0 0 12px;padding:9px 11px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-warn-primary);font-size:12px}
.dti-empty-filter{padding:28px 18px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px}
.dti-small-button{min-height:30px;padding:5px 9px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;cursor:pointer}
.dti-primary-button{min-height:34px;padding:7px 12px;border:0;border-radius:8px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);font:inherit;font-size:12px;font-weight:500;cursor:pointer}
.dti-danger-button{min-height:30px;padding:5px 9px;border:.5px solid var(--dsw-alias-state-error-primary);border-radius:7px;background:transparent;color:var(--dsw-alias-state-error-primary);font:inherit;font-size:11px;cursor:pointer}
.dti-small-button:disabled,.dti-primary-button:disabled,.dti-danger-button:disabled{opacity:.5;cursor:not-allowed}
.dti-workbench button:focus-visible,.dti-workbench input:focus-visible,.dti-workbench select:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
@media (hover:hover){.dti-task-row:not(.is-selected):hover{background:var(--dsw-alias-bg-layer-2)}.dti-small-button:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}}
@media (max-width:1080px){.dti-workbench{grid-template-columns:minmax(0,1fr)}.dti-detail-pane{position:static;max-height:none}}
@media (max-width:720px){.dti-stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dti-toolbar{grid-template-columns:repeat(2,minmax(0,1fr))}.dti-toolbar .dti-search{grid-column:1/-1}.dti-task-row{grid-template-columns:minmax(0,1fr);align-items:start}.dti-task-actions{justify-content:flex-end}}
@media (max-width:440px){.dti-toolbar{grid-template-columns:minmax(0,1fr)}.dti-toolbar .dti-search{grid-column:auto}.dti-detail-meta{grid-template-columns:1fr;gap:3px}.dti-detail-value{margin-bottom:6px}}
@media (prefers-reduced-motion:reduce){.dti-workbench *{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
.dti-execution-workspace{max-width:1440px;margin:0 auto}
.dti-exec-layout{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(280px,.9fr);gap:16px;align-items:start;min-width:0}
.dti-exec-config,.dti-exec-summary{min-width:0;padding:16px;border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
.dti-exec-summary{position:sticky;top:10px}
.dti-exec-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:8px}
@media (max-width:900px){.dti-exec-layout{grid-template-columns:minmax(0,1fr)}.dti-exec-summary{position:static}.dti-exec-actions{grid-column:auto}}
@media (max-width:440px){.dti-exec-actions{flex-direction:column-reverse}.dti-exec-actions button{width:100%}}

`

function errorCode(error: unknown): string {
  if (error instanceof ClientApiError) return error.code
  return 'unknown'
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function sortTodos(todos: readonly Todo[]): Todo[] {
  return [...todos].sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order
    if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1
    if (left.id === right.id) return 0
    return left.id < right.id ? -1 : 1
  })
}

function messageForCode(t: Translate, code: string): string {
  const key = `error.${code}`
  const message = t(key)
  return message === key ? t('error.unknown') : message
}

function formatCreatedAt(iso: string, locale: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  } catch {
    return iso
  }
}

function newRequestId(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID()
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function isSessionSuitableForStrategy(
  session: ExecutionSession,
  strategy: ExecutionStrategy,
): boolean {
  if (strategy === 'reuse') return session.suitableForReuse
  if (strategy === 'fork') return session.suitableForFork
  return strategy === 'new'
}

interface SelectedSourceSessionGate {
  hasSelectedSourceSession: boolean
  selectedSourceSessionSuitable: boolean
}

function selectedSourceSessionGate(
  sessions: readonly ExecutionSession[],
  selectedSessionId: string,
  strategy: ExecutionStrategy,
): SelectedSourceSessionGate {
  const selected = sessions.find((session) => session.sessionId === selectedSessionId)
  return {
    hasSelectedSourceSession: selected !== undefined,
    selectedSourceSessionSuitable:
      selected !== undefined && isSessionSuitableForStrategy(selected, strategy),
  }
}

function strategyLabel(t: Translate, strategy: ExecutionStrategy): string {
  if (strategy === 'reuse') return t('execution.strategy.reuse')
  if (strategy === 'fork') return t('execution.strategy.fork')
  return t('execution.strategy.new')
}

function sessionDisplayLabel(
  t: Translate,
  session: ExecutionSession,
  idLength = 8,
): string {
  const title =
    typeof session.title === 'string' && session.title.trim() !== ''
      ? session.title
      : t('execution.titleUnknown')
  const flags: string[] = []
  if (session.blankState === 'blank') flags.push(t('execution.session.blank'))
  if (session.blankState === 'unknown') flags.push(t('execution.session.stateUnknown'))
  if (!session.stored) flags.push(t('execution.session.notFound'))
  else if (session.live) flags.push(t('execution.session.live'))
  const base = flags.length === 0 ? title : `${title} (${flags.join(', ')})`
  return `${base} · ${sessionShortCode(session.sessionId, idLength)}`
}

// ---------------------------------------------------------------------------
// Execution history helpers (pure; also exercised through the test hook).
// ---------------------------------------------------------------------------

const UNRESOLVED_EXECUTION_STATUSES: readonly DispatchStatus[] = [
  'prepared',
  'session_ready',
  'dispatching',
  'unknown',
]

function isUnresolvedExecution(record: ClientExecutionRecord): boolean {
  return UNRESOLVED_EXECUTION_STATUSES.includes(record.status)
}

function unresolvedExecutions(records: readonly ClientExecutionRecord[]): ClientExecutionRecord[] {
  return records
    .filter(isUnresolvedExecution)
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

function defaultHistorySelection(
  records: readonly ClientExecutionRecord[],
  preferredId?: string,
): ClientExecutionRecord | null {
  if (preferredId !== undefined) {
    const preferred = records.find((record) => record.executionId === preferredId)
    if (preferred !== undefined) return preferred
  }
  return unresolvedExecutions(records)[0] ?? null
}

/** The side-effect-free reset applied when switching to another Todo. */
function emptyExecutionHistory(): {
  records: ClientExecutionRecord[]
  selectedExecutionId: string | null
} {
  return { records: [], selectedExecutionId: null }
}

function shortExecutionId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 8)}…`
}

function shortSessionId(id: string, length = 8): string {
  return sessionShortCode(id, length)
}

interface ExecutionSessionFields {
  source?: string
  target?: string
  /** Reuse where source === persisted target; show one merged row. */
  shared: boolean
  /** No target has been persisted yet (a pending association may exist). */
  targetMissing: boolean
}

function dedupeExecutionSessions(sessions: readonly ExecutionSession[]): ExecutionSession[] {
  const byId = new Map<string, ExecutionSession>()
  for (const session of sessions) {
    if (!byId.has(session.sessionId)) byId.set(session.sessionId, session)
  }
  return [...byId.values()]
}

function sessionShortCode(sessionId: string, length = 8): string {
  const core = sessionId.startsWith('session-') ? sessionId.slice('session-'.length) : sessionId
  return core.length <= length ? core : core.slice(0, length)
}

/** Short-id length that keeps every Session in this list distinguishable. */
function sessionLabelIdLength(sessions: readonly ExecutionSession[]): number {
  const unique = [...new Set(sessions.map((session) => session.sessionId))]
  const maxLength = Math.max(8, ...unique.map((id) => (id.startsWith('session-') ? id.length - 8 : id.length)))
  for (let length = 8; length < maxLength; length += 4) {
    const codes = unique.map((id) => sessionShortCode(id, length))
    if (new Set(codes).size === codes.length) return length
  }
  return maxLength
}

interface ConfirmDispatchGateInput {
  strategy: ExecutionStrategy
  hasSelectedSourceSession: boolean
  selectedSourceSessionSuitable: boolean
  dispatchBusy: boolean
  sessionApiAvailable: boolean
  historyPhase: 'idle' | 'loading' | 'loaded' | 'error'
  dispatchReady: boolean
  capabilityChecking: boolean
  workspaceReady: boolean
  hasUnresolvedExecution: boolean
  hasCurrentExecution: boolean
}

/** Single gate for starting a brand-new execution. */
function canConfirmDispatch(input: ConfirmDispatchGateInput): boolean {
  const sourceSessionReady = input.strategy === 'new' ||
    (input.hasSelectedSourceSession && input.selectedSourceSessionSuitable)
  return (
    !input.dispatchBusy &&
    input.sessionApiAvailable &&
    input.historyPhase === 'loaded' &&
    input.dispatchReady &&
    !input.capabilityChecking &&
    input.workspaceReady &&
    sourceSessionReady &&
    !input.hasUnresolvedExecution &&
    !input.hasCurrentExecution
  )
}

interface DispatchSelectedGateInput {
  dispatchBusy: boolean
  sessionApiAvailable: boolean
  historyPhase: 'idle' | 'loading' | 'loaded' | 'error'
  dispatchReady: boolean
  capabilityChecking: boolean
  hasSelectedExecution: boolean
}

/** Gate for continue/recover/Prompt-retry actions on a selected execution. */
function canDispatchSelected(input: DispatchSelectedGateInput): boolean {
  return (
    !input.dispatchBusy &&
    input.sessionApiAvailable &&
    input.historyPhase === 'loaded' &&
    input.dispatchReady &&
    !input.capabilityChecking &&
    input.hasSelectedExecution
  )
}

/**
 * Map the persisted execution fields to the UI's source/target model:
 * - new: only target (source does not exist);
 * - reuse: source and target are the same Session; merge only when the target
 *   was actually persisted;
 * - fork: source is the parent, target is the child.
 * `pendingTarget` is the Client's actual created Session id that has not been
 * persisted on the execution yet; for reuse it must never be shown as a target.
 */
function executionSessionFields(
  record: Pick<
    ClientExecutionRecord,
    'strategy' | 'sourceSessionId' | 'targetSessionId'
  >,
  pendingTarget?: string,
): ExecutionSessionFields {
  const source = record.sourceSessionId
  const persistedTarget = record.targetSessionId
  const pending =
    persistedTarget === undefined &&
    pendingTarget !== undefined &&
    !(record.strategy === 'reuse' && pendingTarget === source)
      ? pendingTarget
      : undefined
  const target = persistedTarget ?? pending
  return {
    source,
    target,
    shared:
      record.strategy === 'reuse' &&
      persistedTarget !== undefined &&
      source !== undefined &&
      persistedTarget === source,
    targetMissing: target === undefined,
  }
}

// ---------------------------------------------------------------------------
// Dispatch orchestration (also exercised directly by Node tests through the
// test hook below; it never touches React or the DOM).
// ---------------------------------------------------------------------------

function dispatchErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as {
      code?: unknown
      error?: unknown
      message?: unknown
    }
    if (typeof candidate.error === 'object' && candidate.error !== null) {
      const inner = candidate.error as { code?: unknown }
      if (typeof inner.code === 'string') return inner.code
    }
    if (typeof candidate.code === 'string') return candidate.code
    if (typeof candidate.message === 'string' && candidate.message !== '') return candidate.message
  }
  return 'client/transport'
}

/**
 * A thrown Session Controller error (SessionCreateError/SessionForkError or an
 * error carrying a Remote failure code) means the Host answered, so the
 * operation definitely failed. Other throws (network drop, page abort) leave
 * the outcome unknown and must never be retried automatically.
 */
/**
 * Only errors that prove the Host rejected the operation before a Session was
 * created may be treated as definite failures. A network timeout, dropped
 * connection or any transport-level code can happen after the Host committed
 * the Session, so those stay unknown. Having a `code` field alone is not
 * sufficient: connection errors also carry one.
 */
const DEFINITE_SESSION_ERROR_CODES = new Set([
  'session/conflict',
  'session/agent-busy',
  'session/provider-models-unavailable',
  'session/not-found',
  'remote-access/denied',
  'workspace/missing-dir',
  'workspace/not-found',
])

function sessionErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const candidate = error as { code?: unknown; error?: unknown }
  if (typeof candidate.error === 'object' && candidate.error !== null) {
    const inner = candidate.error as { code?: unknown }
    if (typeof inner.code === 'string') return inner.code
  }
  return typeof candidate.code === 'string' ? candidate.code : undefined
}

function isDefiniteSessionOperationError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { name?: unknown }
  const typed = candidate.name === 'SessionCreateError' || candidate.name === 'SessionForkError'
  if (!typed) return false
  const code = sessionErrorCode(error)
  return code !== undefined && DEFINITE_SESSION_ERROR_CODES.has(code)
}

async function runPromptPhase(
  deps: { host: DispatchHostApi; sessions?: ClientSessionsApi },
  record: ClientExecutionRecord,
): Promise<DispatchRunResult> {
  const sessions = deps.sessions
  if (sessions === undefined) {
    return { status: 'unavailable', execution: record, message: 'Session API is unavailable.' }
  }

  // Always re-read the Host state first so a stale Client cannot resend a
  // Prompt that the Host/log already proves accepted.
  let latest: ClientExecutionRecord
  try {
    latest = await deps.host.status(record.executionId)
  } catch (error) {
    return { status: 'error', execution: record, errorCode: dispatchErrorCode(error) }
  }
  if (latest.status === 'accepted') {
    return { status: 'accepted', execution: latest, sessionId: latest.targetSessionId }
  }
  if (latest.status === 'failed') {
    return { status: 'failed', execution: latest, sessionId: latest.targetSessionId }
  }
  if (latest.status === 'unknown') {
    // A normal prompt phase must not treat unknown as session_ready. Callers
    // must use authorizePromptRetry() first, which also re-verifies the log.
    return {
      status: 'unknown',
      execution: latest,
      sessionId: latest.targetSessionId,
      errorCode: 'prompt_retry_not_authorized',
    }
  }
  if (latest.status === 'prepared') {
    return { status: 'prepared', execution: latest, sessionId: latest.targetSessionId }
  }
  record = latest

  const sessionId = record.targetSessionId
  if (sessionId === undefined) {
    return { status: 'prepared', execution: record, message: 'No target Session was persisted.' }
  }

  let dispatching: ClientExecutionRecord
  if (record.status === 'session_ready') {
    try {
      dispatching = await deps.host.dispatching(record.executionId)
    } catch (error) {
      return { status: 'error', execution: record, errorCode: dispatchErrorCode(error) }
    }
  } else if (record.status === 'dispatching') {
    dispatching = record
  } else {
    return { status: record.status, execution: record, sessionId }
  }

  let reference: ClientSessionReference
  try {
    reference = sessions.retain(sessionId, { source: 'controllerOperation' })
  } catch (error) {
    // Session exists; nothing was sent. Keep the execution resumable.
    return {
      status: 'session_ready',
      execution: dispatching,
      sessionId,
      errorCode: dispatchErrorCode(error),
    }
  }

  try {
    try {
      await reference.ready
    } catch (error) {
      return {
        status: 'session_ready',
        execution: dispatching,
        sessionId,
        errorCode: dispatchErrorCode(error),
      }
    }

    let result: ClientPromptResult
    try {
      result = await reference.binding.session.prompt(
        [{ type: 'text', text: dispatching.promptText }],
        'queue',
        undefined,
        dispatching.requestId,
      )
    } catch (error) {
      const code = dispatchErrorCode(error)
      try {
        const updated = await deps.host.result(dispatching.executionId, 'unknown', code)
        return { status: updated.status, execution: updated, sessionId, errorCode: code }
      } catch {
        return { status: 'unknown', execution: dispatching, sessionId, errorCode: code }
      }
    }

    if (result.ok) {
      try {
        const updated = await deps.host.result(dispatching.executionId, 'accepted')
        return { status: updated.status, execution: updated, sessionId }
      } catch (error) {
        // The Prompt was accepted by DSH, but the Host could not persist the
        // result. Keep the record as pending verification; never treat this as
        // a normal failure that allows creating another Session.
        return {
          status: 'dispatching',
          execution: dispatching,
          sessionId,
          errorCode: 'host_result_unavailable',
        }
      }
    }
    const code = result.error?.code ?? 'prompt/rejected'
    try {
      const updated = await deps.host.result(dispatching.executionId, 'failed', code)
      return { status: updated.status, execution: updated, sessionId, errorCode: code }
    } catch {
      // The Prompt was rejected but the Host could not record it. Keep it
      // pending for a later status check instead of allowing a new Session.
      return {
        status: 'dispatching',
        execution: dispatching,
        sessionId,
        errorCode: 'host_result_unavailable',
      }
    }
  } finally {
    try {
      reference.release()
    } catch {
      // Releasing an already-dropped reference is harmless.
    }
  }
}

/**
 * Perform the non-idempotent Session operation (create/reuse/fork) for an
 * already persisted execution, then prompt. The execution must be prepared.
 */
async function runSessionOperation(
  deps: { host: DispatchHostApi; sessions?: ClientSessionsApi },
  record: ClientExecutionRecord,
): Promise<DispatchRunResult> {
  const sessions = deps.sessions
  if (sessions === undefined) {
    return { status: 'unavailable', execution: record, message: 'Session API is unavailable.' }
  }

  let acquisition: { execution: ClientExecutionRecord; acquired: boolean }
  try {
    acquisition = await deps.host.acquire(record.executionId)
  } catch (error) {
    return { status: 'error', execution: record, errorCode: dispatchErrorCode(error) }
  }
  record = acquisition.execution
  if (!acquisition.acquired) {
    // Another client owns the (or an already attempted) non-idempotent
    // operation. Never call create/fork without acquired === true.
    return {
      status: record.status,
      execution: record,
      sessionId: record.targetSessionId,
      errorCode: 'dispatch_lease_not_acquired',
    }
  }

  let sessionId: string | undefined
  try {
    if (record.strategy === 'new') {
      sessionId = await sessions.create({ workspaceId: record.workspaceId })
    } else if (record.strategy === 'reuse') {
      if (record.sourceSessionId === undefined) {
        return { status: 'failed', execution: record, errorCode: 'source_session_required' }
      }
      try {
        await sessions.refresh?.()
      } catch {
        // The retain below reports the actionable failure.
      }
      sessionId = record.sourceSessionId
    } else {
      if (record.sourceSessionId === undefined) {
        return { status: 'failed', execution: record, errorCode: 'source_session_required' }
      }
      sessionId = await sessions.fork({ sessionId: record.sourceSessionId, allowMigration: false })
    }
  } catch (error) {
    const code = dispatchErrorCode(error)
    const definite = isDefiniteSessionOperationError(error)
    try {
      const updated = definite
        ? await deps.host.failed(record.executionId, code)
        : await deps.host.unknown(record.executionId, code)
      return { status: updated.status, execution: updated, errorCode: code }
    } catch {
      return { status: definite ? 'failed' : 'unknown', execution: record, errorCode: code }
    }
  }

  if (sessionId === undefined || sessionId === '') {
    return { status: 'failed', execution: record, errorCode: 'session_missing' }
  }

  let ready: ClientExecutionRecord
  try {
    ready = await deps.host.sessionReady(record.executionId, sessionId)
  } catch (error) {
    return {
      status: 'error',
      execution: record,
      sessionId,
      errorCode: dispatchErrorCode(error),
    }
  }
  return runPromptPhase(deps, ready)
}

/**
 * Client-side dispatch orchestration:
 * Host intent (validated + persisted) → authorized Remote create/fork →
 * persist actual Session id → authorized Remote prompt (same requestId).
 *
 * A Session that was created but whose association could not be persisted is
 * returned with `status: 'error'` and its id, without sending a prompt.
 */
async function runDispatchFlow(
  deps: { host: DispatchHostApi; sessions?: ClientSessionsApi },
  request: ExecutionIntentInput,
): Promise<DispatchRunResult> {
  if (deps.sessions === undefined) {
    return { status: 'unavailable', message: 'The Session API is unavailable in this client.' }
  }

  let record: ClientExecutionRecord
  try {
    record = await deps.host.intent(request)
  } catch (error) {
    return { status: 'error', errorCode: dispatchErrorCode(error) }
  }
  if (record.status !== 'prepared') {
    return { status: record.status, execution: record, sessionId: record.targetSessionId }
  }
  return runSessionOperation(deps, record)
}

/**
 * Resume an existing execution without creating a new intent:
 * - prepared → the pending create/fork is resumed;
 * - session_ready / dispatching / unknown with target → prompt retry/check;
 * - unknown without target → recovery is required (candidates), never retry
 *   the non-idempotent create/fork.
 */
async function resumeDispatchFlow(
  deps: { host: DispatchHostApi; sessions?: ClientSessionsApi },
  record: ClientExecutionRecord,
): Promise<DispatchRunResult> {
  if (deps.sessions === undefined) {
    return { status: 'unavailable', execution: record, message: 'Session API is unavailable.' }
  }

  // Never trust the caller's copy: refresh the Host state and the log-derived
  // verification first. This also prevents re-sending an accepted Prompt.
  let latest: ClientExecutionRecord
  try {
    latest = await deps.host.status(record.executionId)
  } catch (error) {
    return { status: 'error', execution: record, errorCode: dispatchErrorCode(error) }
  }
  if (latest.status === 'accepted') {
    return { status: 'accepted', execution: latest, sessionId: latest.targetSessionId }
  }
  if (latest.status === 'failed') {
    return { status: 'failed', execution: latest, sessionId: latest.targetSessionId }
  }

  // Reuse executions can recover by re-binding their original source Session
  // without creating/forking anything. The Host re-checks the log first.
  if (
    latest.strategy === 'reuse' &&
    latest.targetSessionId === undefined &&
    (latest.status === 'prepared' || latest.status === 'dispatching' || latest.status === 'unknown')
  ) {
    let recovery: { execution: ClientExecutionRecord; recovered: boolean }
    try {
      recovery = await deps.host.recoverReuse(latest.executionId)
    } catch (error) {
      return { status: 'error', execution: latest, errorCode: dispatchErrorCode(error) }
    }
    if (!recovery.recovered) {
      return {
        status: recovery.execution.status,
        execution: recovery.execution,
        errorCode: recovery.execution.errorCode ?? 'reuse_recovery_unavailable',
      }
    }
    if (recovery.execution.status === 'accepted') {
      return {
        status: 'accepted',
        execution: recovery.execution,
        sessionId: recovery.execution.targetSessionId,
      }
    }
    return runPromptPhase(deps, recovery.execution)
  }

  if (latest.status === 'prepared') return runSessionOperation(deps, latest)
  if (latest.status === 'unknown') {
    if (latest.targetSessionId === undefined) {
      return {
        status: 'unknown',
        execution: latest,
        errorCode: 'prompt_retry_not_authorized',
      }
    }
    let authorization: { execution: ClientExecutionRecord; authorized: boolean }
    try {
      authorization = await deps.host.authorizePromptRetry(latest.executionId)
    } catch (error) {
      return { status: 'error', execution: latest, errorCode: dispatchErrorCode(error) }
    }
    if (authorization.execution.status === 'accepted') {
      return {
        status: 'accepted',
        execution: authorization.execution,
        sessionId: authorization.execution.targetSessionId,
      }
    }
    if (!authorization.authorized) {
      return {
        status: authorization.execution.status,
        execution: authorization.execution,
        sessionId: authorization.execution.targetSessionId,
        errorCode: 'prompt_retry_not_authorized',
      }
    }
    return runPromptPhase(deps, authorization.execution)
  }
  if (latest.status === 'session_ready' || latest.status === 'dispatching') {
    return runPromptPhase(deps, latest)
  }
  return { status: latest.status, execution: latest, sessionId: latest.targetSessionId }
}

/** Retry only the Prompt phase of an already persisted target Session. */
async function continueDispatch(
  deps: { host: DispatchHostApi; sessions?: ClientSessionsApi },
  execution: ClientExecutionRecord,
): Promise<DispatchRunResult> {
  return runPromptPhase(deps, execution)
}

interface TaskInboxTestHooks {
  runDispatchFlow: typeof runDispatchFlow
  resumeDispatchFlow: typeof resumeDispatchFlow
  continueDispatch: typeof continueDispatch
  unresolvedExecutions: typeof unresolvedExecutions
  defaultHistorySelection: typeof defaultHistorySelection
  executionSessionFields: typeof executionSessionFields
  shortExecutionId: typeof shortExecutionId
  shortSessionId: typeof shortSessionId
  emptyExecutionHistory: typeof emptyExecutionHistory
  canConfirmDispatch: typeof canConfirmDispatch
  selectedSourceSessionGate: typeof selectedSourceSessionGate
  canDispatchSelected: typeof canDispatchSelected
  dedupeExecutionSessions: typeof dedupeExecutionSessions
  sessionShortCode: typeof sessionShortCode
  sessionLabelIdLength: typeof sessionLabelIdLength
  sessionDisplayLabel: typeof sessionDisplayLabel
}

;(window as unknown as { __DSH_TASK_INBOX_TEST__?: TaskInboxTestHooks }).__DSH_TASK_INBOX_TEST__ = {
  runDispatchFlow,
  resumeDispatchFlow,
  continueDispatch,
  unresolvedExecutions,
  defaultHistorySelection,
  executionSessionFields,
  shortExecutionId,
  shortSessionId,
  emptyExecutionHistory,
  canConfirmDispatch,
  selectedSourceSessionGate,
  canDispatchSelected,
  dedupeExecutionSessions,
  sessionShortCode,
  sessionLabelIdLength,
  sessionDisplayLabel,
}

window.__ModuleLoader__.load({
  id: PACKAGE_ID,
  factory(require) {
    const React = require('react') as ReactApi

    function h(
      type: unknown,
      props?: Record<string, unknown> | null,
      ...children: unknown[]
    ): unknown {
      return React.createElement(type, props, ...children)
    }

    function svgIcon(size: number, paths: readonly string[]): unknown {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': '1.8',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        ...paths.map((path, index) => h('path', { key: `p${index}`, d: path })),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const english = ctx.locale.register(LOCALE_NS, 'en', DICTIONARIES.en)
          const chinese = ctx.locale.register(LOCALE_NS, 'zh', DICTIONARIES.zh)
          return () => {
            english()
            chinese()
          }
        })

        function TaskInboxIcon(props: { size?: number; active?: boolean }): unknown {
          const size = props.size ?? 18
          const color = props.active
            ? 'var(--dsw-alias-brand-primary)'
            : 'var(--dsw-alias-label-secondary)'
          return h(
            'svg',
            {
              viewBox: '0 0 24 24',
              width: size,
              height: size,
              fill: 'none',
              stroke: color,
              'stroke-width': '1.7',
              'stroke-linecap': 'round',
              'stroke-linejoin': 'round',
              role: 'img',
              'aria-hidden': true,
              style: { display: 'block' },
            },
            h('path', { d: 'M3.5 13.5 5 6.9A2 2 0 0 1 7 5.5h10a2 2 0 0 1 1.9 1.4l1.6 6.6' }),
            h('path', { d: 'M3.5 13.5v4a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-4' }),
            h('path', { d: 'M7 13.5h2.6l1.3 2h2.2l1.3-2h2.6' }),
            h('path', { d: 'm9.2 9.4 1.9 1.9 3.4-3.6' }),
          )
        }

        function iconButton(
          label: string,
          iconPaths: readonly string[],
          onClick: () => void,
          options?: { disabled?: boolean; danger?: boolean },
        ): unknown {
          const disabled = options?.disabled === true
          const style: Style = {
            ...STYLES.iconButton,
            ...(options?.danger === true
              ? { color: 'var(--dsw-alias-state-error-primary)' }
              : {}),
            ...(disabled ? { opacity: 0.4, cursor: 'default' } : {}),
          }
          return h(
            'button',
            {
              type: 'button',
              onClick,
              disabled,
              'aria-label': label,
              title: label,
              style,
            },
            svgIcon(14, iconPaths),
          )
        }

        function TaskInboxPage(): unknown {
          const t = ctx.locale.bind(LOCALE_NS)
          const snapshot = ctx.locale.getSnapshot()
          const dateLocale = snapshot.active === 'zh' ? 'zh-CN' : 'en-US'

          const [, setLocaleRevision] = React.useState(0)
          React.useEffect(
            () => ctx.locale.subscribe(() => setLocaleRevision((value) => value + 1)),
            [],
          )

          const [todos, setTodos] = React.useState<Todo[]>([])
          const [executionOverview, setExecutionOverview] = React.useState<ClientExecutionOverviewRecord[]>([])
          const [overviewPhase, setOverviewPhase] = React.useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
          const [overviewError, setOverviewError] = React.useState<string | null>(null)
          const [selectedTodoId, setSelectedTodoId] = React.useState<string | null>(null)
          const [searchQuery, setSearchQuery] = React.useState('')
          const [statusFilter, setStatusFilter] = React.useState<'all' | 'undispatched' | 'unresolved' | 'accepted'>('all')
          const [workspaceFilter, setWorkspaceFilter] = React.useState('')
          const [strategyFilter, setStrategyFilter] = React.useState<'all' | ExecutionStrategy>('all')
          const [sortMode, setSortMode] = React.useState<'manual' | 'recent' | 'created'>('manual')
          const [detailExecutions, setDetailExecutions] = React.useState<ClientExecutionRecord[]>([])
          const [detailHistoryPhase, setDetailHistoryPhase] = React.useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
          const [detailHistoryError, setDetailHistoryError] = React.useState<string | null>(null)
          const [expandedExecutionId, setExpandedExecutionId] = React.useState<string | null>(null)
          const [loading, setLoading] = React.useState(true)
          const [loadError, setLoadError] = React.useState<string | null>(null)
          const [banner, setBanner] = React.useState<Banner | null>(null)
          const [editorMode, setEditorMode] = React.useState<'create' | 'edit' | null>(null)
          const [editingId, setEditingId] = React.useState<string | null>(null)
          const [formTitle, setFormTitle] = React.useState('')
          const [formDescription, setFormDescription] = React.useState('')
          const [formError, setFormError] = React.useState<string | null>(null)
          const [saving, setSaving] = React.useState(false)
          const [busyId, setBusyId] = React.useState<string | null>(null)
          const [confirmId, setConfirmId] = React.useState<string | null>(null)
          const [executionTarget, setExecutionTarget] = React.useState<Todo | null>(null)
          const [executionContext, setExecutionContext] =
            React.useState<ExecutionContextSnapshot | null>(null)
          const [executionLoading, setExecutionLoading] = React.useState(false)
          const [executionError, setExecutionError] = React.useState<string | null>(null)
          const [executionWorkspaceId, setExecutionWorkspaceId] = React.useState('')
          const [executionStrategy, setExecutionStrategy] =
            React.useState<ExecutionStrategy>('new')
          const [executionSessionId, setExecutionSessionId] = React.useState('')
          const [executionNotice, setExecutionNotice] = React.useState<string | null>(null)
          const [dispatchBusy, setDispatchBusy] = React.useState(false)
          const [dispatchResult, setDispatchResult] = React.useState<ClientExecutionRecord | null>(null)
          const [dispatchSessionId, setDispatchSessionId] = React.useState<string | null>(null)
          const [dispatchMessage, setDispatchMessage] = React.useState<string | null>(null)
          const [dispatchError, setDispatchError] = React.useState<string | null>(null)
          const [dispatchCandidates, setDispatchCandidates] =
            React.useState<DispatchCandidate[] | null>(null)
          const [abandonConfirm, setAbandonConfirm] = React.useState(false)
          const [reuseRecoveryConfirm, setReuseRecoveryConfirm] = React.useState(false)
          const [executionHistory, setExecutionHistory] = React.useState<ClientExecutionRecord[]>([])
          const [selectedExecutionId, setSelectedExecutionId] = React.useState<string | null>(null)
          const [historyPhase, setHistoryPhase] = React.useState<
            'idle' | 'loading' | 'loaded' | 'error'
          >('idle')
          const [historyError, setHistoryError] = React.useState<string | null>(null)
          const [dispatchReady, setDispatchReady] = React.useState(false)
          const [dispatchReason, setDispatchReason] = React.useState<string | null>(null)
          const [capabilityChecking, setCapabilityChecking] = React.useState(false)
          const historyLoading = historyPhase === 'loading'
          const dispatchLockRef = React.useRef(false)

          // Capability depends on the selected strategy/workspace and must be
          // re-checked whenever either changes.
          React.useEffect(() => {
            if (executionTarget === null) return
            void refreshDispatchCapability(executionStrategy, executionWorkspaceId)
          }, [executionTarget, executionStrategy, executionWorkspaceId])

          // Keep the selected/current execution reflected in the loaded history
          // list without introducing a separate history page.
          React.useEffect(() => {
            if (dispatchResult === null) return
            setSelectedExecutionId(dispatchResult.executionId)
            setExecutionHistory((previous) => {
              const index = previous.findIndex(
                (record) => record.executionId === dispatchResult.executionId,
              )
              if (index !== -1 && previous[index] === dispatchResult) return previous
              const next = previous.slice()
              if (index === -1) next.unshift(dispatchResult)
              else next[index] = dispatchResult
              return next
            })
          }, [dispatchResult])
          const titleInputRef = React.useRef<{ focus(): void } | null>(null)

          React.useEffect(() => {
            const controller = new AbortController()
            void load(controller.signal)
            void loadExecutionOverview(controller.signal)
            return () => controller.abort()
          }, [])

          React.useEffect(() => {
            if (todos.length === 0) {
              if (selectedTodoId !== null) setSelectedTodoId(null)
              return
            }
            if (selectedTodoId === null || !todos.some((todo) => todo.id === selectedTodoId)) {
              setSelectedTodoId(todos[0].id)
            }
          }, [todos, selectedTodoId])

          React.useEffect(() => {
            if (selectedTodoId === null) {
              setDetailExecutions([])
              setDetailHistoryPhase('idle')
              setDetailHistoryError(null)
              return
            }
            const controller = new AbortController()
            setDetailHistoryPhase('loading')
            setDetailHistoryError(null)
            void loadDetailHistory(selectedTodoId, controller.signal)
            return () => controller.abort()
          }, [selectedTodoId])

          React.useEffect(() => {
            if (executionTarget === null || historyPhase !== 'loaded') return
            void loadExecutionOverview()
          }, [executionHistory, executionTarget, historyPhase])

          React.useEffect(() => {
            if (editorMode !== null) titleInputRef.current?.focus()
          }, [editorMode, editingId])

          React.useEffect(() => {
            if (banner === null || banner.kind !== 'success') return
            const timer = window.setTimeout(() => setBanner(null), 2200)
            return () => window.clearTimeout(timer)
          }, [banner])

          async function load(signal?: AbortSignal): Promise<void> {
            setLoading(true)
            setLoadError(null)
            try {
              const data = await callApi<{ todos: Todo[] }>({ op: 'list' }, signal)
              setTodos(sortTodos(data.todos))
            } catch (error) {
              if (!isAbort(error)) setLoadError(errorCode(error))
            } finally {
              if (signal === undefined || !signal.aborted) setLoading(false)
            }
          }

          async function loadExecutionOverview(signal?: AbortSignal): Promise<void> {
            setOverviewPhase('loading')
            setOverviewError(null)
            try {
              const data = await callApi<{ executions: ClientExecutionOverviewRecord[] }>(
                { op: 'execution-overview' },
                signal,
              )
              setExecutionOverview(Array.isArray(data.executions) ? data.executions : [])
              setOverviewPhase('loaded')
            } catch (error) {
              if (!isAbort(error)) {
                setOverviewError(messageForCode(t, errorCode(error)))
                setOverviewPhase('error')
              }
            }
          }

          async function loadDetailHistory(todoId: string, signal?: AbortSignal): Promise<void> {
            try {
              const data = await callApi<{ executions: ClientExecutionRecord[] }>(
                { op: 'execution-status', todoId },
                signal,
              )
              if (signal !== undefined && signal.aborted) return
              setDetailExecutions(Array.isArray(data.executions) ? data.executions : [])
              setDetailHistoryPhase('loaded')
            } catch (error) {
              if (!isAbort(error)) {
                setDetailHistoryError(messageForCode(t, errorCode(error)))
                setDetailHistoryPhase('error')
              }
            }
          }

          function clearWorkbenchFilters(): void {
            setSearchQuery('')
            setStatusFilter('all')
            setWorkspaceFilter('')
            setStrategyFilter('all')
            setSortMode('manual')
          }

          function openCreate(): void {
            setEditorMode('create')
            setEditingId(null)
            setFormTitle('')
            setFormDescription('')
            setFormError(null)
            setConfirmId(null)
          }

          function openEdit(todo: Todo): void {
            setEditorMode('edit')
            setEditingId(todo.id)
            setFormTitle(todo.title)
            setFormDescription(todo.description)
            setFormError(null)
            setConfirmId(null)
          }

          function closeEditor(): void {
            if (saving) return
            setEditorMode(null)
            setEditingId(null)
            setFormError(null)
          }

          function validateForm(): string | null {
            const title = formTitle.trim()
            if (title.length === 0) return t('form.required')
            if (title.length > TITLE_MAX_LENGTH) return t('form.tooLongTitle')
            if (formDescription.trim().length > DESCRIPTION_MAX_LENGTH) {
              return t('form.tooLongDescription')
            }
            return null
          }

          async function submitEditor(): Promise<void> {
            if (saving) return
            const problem = validateForm()
            if (problem !== null) {
              setFormError(problem)
              return
            }

            setSaving(true)
            setFormError(null)
            const requestId = newRequestId()
            try {
              if (editorMode === 'edit' && editingId !== null) {
                const data = await callApi<{ todo: Todo }>({
                  op: 'update',
                  id: editingId,
                  title: formTitle,
                  description: formDescription,
                  requestId,
                })
                setTodos((current) =>
                  sortTodos(current.map((todo) => (todo.id === data.todo.id ? data.todo : todo))),
                )
                setBanner({ kind: 'success', message: t('feedback.updated') })
              } else {
                const data = await callApi<{ todo: Todo }>({
                  op: 'create',
                  title: formTitle,
                  description: formDescription,
                  requestId,
                })
                setTodos((current) => sortTodos([...current, data.todo]))
                setBanner({ kind: 'success', message: t('feedback.created') })
              }
              setEditorMode(null)
              setEditingId(null)
              setFormTitle('')
              setFormDescription('')
            } catch (error) {
              setFormError(messageForCode(t, errorCode(error)))
            } finally {
              setSaving(false)
            }
          }

          async function removeTodo(id: string): Promise<void> {
            if (busyId !== null) return
            setBusyId(id)
            try {
              await callApi<{ deleted: boolean }>({ op: 'delete', id })
              setTodos((current) => current.filter((todo) => todo.id !== id))
              setConfirmId(null)
              setBanner({ kind: 'success', message: t('feedback.deleted') })
            } catch (error) {
              setConfirmId(null)
              setBanner({ kind: 'error', message: messageForCode(t, errorCode(error)) })
            } finally {
              setBusyId(null)
            }
          }

          async function moveTodo(id: string, direction: MoveDirection): Promise<void> {
            if (busyId !== null) return
            setBusyId(id)
            try {
              const data = await callApi<{ todos: Todo[] }>({ op: 'move', id, direction })
              setTodos(sortTodos(data.todos))
            } catch (error) {
              setBanner({ kind: 'error', message: messageForCode(t, errorCode(error)) })
            } finally {
              setBusyId(null)
            }
          }

          async function loadExecutionContext(signal?: AbortSignal): Promise<void> {
            setExecutionLoading(true)
            setExecutionError(null)
            try {
              const data = await callApi<{ context: ExecutionContextSnapshot }>(
                { op: 'execution-context' },
                signal,
              )
              setExecutionContext(data.context)
            } catch (error) {
              if (!isAbort(error)) setExecutionError(errorCode(error))
            } finally {
              if (signal === undefined || !signal.aborted) setExecutionLoading(false)
            }
          }

          function openExecution(todo: Todo, preferredExecutionId?: string): void {
            setSelectedTodoId(todo.id)
            setExecutionTarget(todo)
            setExecutionContext(null)
            setExecutionError(null)
            setExecutionLoading(false)
            setExecutionWorkspaceId('')
            setExecutionStrategy('new')
            setExecutionSessionId('')
            setExecutionNotice(null)
            setConfirmId(null)
            setEditorMode(null)
            setEditingId(null)
            const resetHistory = emptyExecutionHistory()
            setExecutionHistory(resetHistory.records)
            setSelectedExecutionId(resetHistory.selectedExecutionId)
            setHistoryPhase('idle')
            setHistoryError(null)
            setDispatchReady(false)
            setDispatchReason(null)
            setCapabilityChecking(false)
            setDispatchResult(null)
            setDispatchSessionId(null)
            setDispatchMessage(null)
            setDispatchError(null)
            setDispatchCandidates(null)
            setAbandonConfirm(false)
            setReuseRecoveryConfirm(false)
            void loadExecutionContext()
            void loadExecutionHistory(todo.id, preferredExecutionId)
          }

          async function loadExecutionHistory(
            todoId: string,
            preferredId?: string,
          ): Promise<void> {
            setHistoryPhase('loading')
            setHistoryError(null)
            try {
              const data = await callApi<{ executions: ClientExecutionRecord[] }>({
                op: 'execution-status',
                todoId,
              })
              const records = Array.isArray(data.executions) ? data.executions : []
              setExecutionHistory(records)
              const chosen = defaultHistorySelection(records, preferredId)
              if (chosen !== null) {
                setSelectedExecutionId(chosen.executionId)
                setDispatchResult(chosen)
                setDispatchSessionId(null)
                setDispatchError(null)
                setDispatchCandidates(null)
                setAbandonConfirm(false)
                setReuseRecoveryConfirm(false)
                setDispatchMessage(
                  isUnresolvedExecution(chosen)
                    ? t('execution.dispatch.resumeHint')
                    : null,
                )
              } else if (preferredId === undefined) {
                setSelectedExecutionId(null)
                setDispatchResult(null)
                setDispatchSessionId(null)
                setDispatchMessage(null)
              }
              setHistoryPhase('loaded')
            } catch (error) {
              // A failed load must not look like "no execution history".
              setHistoryError(messageForCode(t, errorCode(error)))
              setHistoryPhase('error')
            }
          }

          async function refreshDispatchCapability(
            strategy: ExecutionStrategy,
            workspaceId: string,
          ): Promise<void> {
            setCapabilityChecking(true)
            try {
              const data = await callApi<{
                dispatchReady: boolean
                dispatchReason?: string
                dispatchMissing?: string[]
                dispatchWarnings?: string[]
              }>({
                op: 'execution-capability',
                strategy,
                ...(workspaceId === '' ? {} : { workspaceId }),
              })
              setDispatchReady(data.dispatchReady === true)
              setDispatchReason(
                data.dispatchReady === true ? null : (data.dispatchReason ?? null),
              )
            } catch (error) {
              setDispatchReady(false)
              setDispatchReason(messageForCode(t, errorCode(error)))
            } finally {
              setCapabilityChecking(false)
            }
          }

          async function reloadExecutionState(): Promise<void> {
            if (executionTarget === null) return
            setDispatchReady(false)
            setDispatchReason(null)
            await Promise.all([
              loadExecutionHistory(executionTarget.id, selectedExecutionId ?? undefined),
              refreshDispatchCapability(executionStrategy, executionWorkspaceId),
            ])
          }

          function currentWorkspaceReady(): boolean {
            if (executionContext === null || executionWorkspaceId === '') return false
            const workspace = executionContext.workspaces.find(
              (entry) => entry.id === executionWorkspaceId,
            )
            return workspace !== undefined && workspace.available
          }

          function currentConfirmGate(): boolean {
            const sessions = ctx.get?.<ClientSessionsApi>('sessions')
            const sessionsInWorkspace =
              executionContext === null
                ? []
                : dedupeExecutionSessions(
                    executionContext.sessions.filter(
                      (session) => session.workspaceId === executionWorkspaceId,
                    ),
                  )
            return canConfirmDispatch({
              strategy: executionStrategy,
              ...selectedSourceSessionGate(
                sessionsInWorkspace,
                executionSessionId,
                executionStrategy,
              ),
              dispatchBusy,
              sessionApiAvailable: sessions !== undefined,
              historyPhase,
              dispatchReady,
              capabilityChecking,
              workspaceReady: currentWorkspaceReady(),
              hasUnresolvedExecution: unresolvedExecutions(executionHistory).length > 0,
              hasCurrentExecution: dispatchResult !== null,
            })
          }

          function currentSelectedGate(): boolean {
            const sessions = ctx.get?.<ClientSessionsApi>('sessions')
            return canDispatchSelected({
              dispatchBusy,
              sessionApiAvailable: sessions !== undefined,
              historyPhase,
              dispatchReady,
              capabilityChecking,
              hasSelectedExecution: dispatchResult !== null,
            })
          }

          function dispatchGateMessage(): string {
            if (historyPhase === 'idle' || historyPhase === 'loading') {
              return t('execution.dispatch.historyLoading')
            }
            if (historyPhase === 'error') {
              return historyError ?? t('execution.dispatch.historyUnavailable')
            }
            if (!dispatchReady) {
              return t('execution.dispatch.capabilityUnavailable').replace(
                '{reason}',
                dispatchReason ?? t('error.execution_unavailable'),
              )
            }
            if (!currentWorkspaceReady()) return t('execution.error.workspaceRequired')
            if (unresolvedExecutions(executionHistory).length > 0) {
              return t('execution.dispatch.resumeRequired')
            }
            if (dispatchSessionUnavailable()) return t('execution.dispatch.noService')
            return t('execution.dispatch.gateBlocked')
          }

          function dispatchSessionUnavailable(): boolean {
            return ctx.get?.<ClientSessionsApi>('sessions') === undefined
          }

          function selectExecution(record: ClientExecutionRecord): void {
            if (dispatchBusy) return
            setSelectedExecutionId(record.executionId)
            setDispatchResult(record)
            setDispatchSessionId(null)
            setDispatchError(null)
            setDispatchCandidates(null)
            setAbandonConfirm(false)
            setReuseRecoveryConfirm(false)
            setDispatchMessage(
              isUnresolvedExecution(record) ? t('execution.dispatch.resumeHint') : null,
            )
          }

          function executionHostApi(): DispatchHostApi {
            return {
              intent: async (input) =>
                (
                  await callApi<{ execution: ClientExecutionRecord }>({
                    op: 'execution-intent',
                    clientRequestId: input.clientRequestId,
                    todoId: input.todoId,
                    strategy: input.strategy,
                    workspaceId: input.workspaceId,
                    ...(input.sourceSessionId === undefined
                      ? {}
                      : { sourceSessionId: input.sourceSessionId }),
                  })
                ).execution,
              status: async (executionId) =>
                (
                  await callApi<{ execution: ClientExecutionRecord }>({
                    op: 'execution-status',
                    executionId,
                  })
                ).execution,
              acquire: async (executionId) => {
                const data = await callApi<{
                  execution: ClientExecutionRecord
                  acquired: boolean
                }>({
                  op: 'execution-acquire',
                  executionId,
                })
                return { execution: data.execution, acquired: data.acquired }
              },
              authorizePromptRetry: async (executionId) => {
                const data = await callApi<{
                  execution: ClientExecutionRecord
                  authorized: boolean
                }>({
                  op: 'execution-prompt-retry',
                  executionId,
                })
                return { execution: data.execution, authorized: data.authorized }
              },
              recoverReuse: async (executionId) => {
                const data = await callApi<{
                  execution: ClientExecutionRecord
                  recovered: boolean
                }>({
                  op: 'execution-reuse-recover',
                  executionId,
                })
                return { execution: data.execution, recovered: data.recovered }
              },
              sessionReady: async (executionId, sessionId) =>
                (
                  await callApi<{ execution: ClientExecutionRecord }>({
                    op: 'execution-session',
                    executionId,
                    sessionId,
                  })
                ).execution,
              dispatching: async (executionId) =>
                (
                  await callApi<{ execution: ClientExecutionRecord }>({
                    op: 'execution-dispatching',
                    executionId,
                  })
                ).execution,
              result: async (executionId, outcome, errorCode) =>
                (
                  await callApi<{ execution: ClientExecutionRecord }>({
                    op: 'execution-result',
                    executionId,
                    outcome,
                    ...(errorCode === undefined ? {} : { errorCode }),
                  })
                ).execution,
              unknown: async (executionId, errorCode) =>
                (
                  await callApi<{ execution: ClientExecutionRecord }>({
                    op: 'execution-unknown',
                    executionId,
                    ...(errorCode === undefined ? {} : { errorCode }),
                  })
                ).execution,
              failed: async (executionId, errorCode) =>
                (
                  await callApi<{ execution: ClientExecutionRecord }>({
                    op: 'execution-failed',
                    executionId,
                    ...(errorCode === undefined ? {} : { errorCode }),
                  })
                ).execution,
              abandon: async (executionId) =>
                (
                  await callApi<{ execution: ClientExecutionRecord }>({
                    op: 'execution-abandon',
                    executionId,
                  })
                ).execution,
            }
          }

          function describeDispatchStatus(status: string): string {
            const key = `execution.status.${status}`
            const text = t(key)
            return text === key ? status : text
          }

          async function startDispatch(): Promise<void> {
            if (dispatchBusy || executionTarget === null) return
            if (executionWorkspaceId === '') {
              setDispatchError(t('execution.error.workspaceRequired'))
              return
            }
            const workspace = executionContext?.workspaces.find(
              (entry) => entry.id === executionWorkspaceId,
            )
            if (workspace === undefined) {
              setDispatchError(t('execution.error.workspaceRequired'))
              return
            }
            if (!workspace.available) {
              setDispatchError(t('execution.error.workspaceUnavailable'))
              return
            }
            if (executionStrategy !== 'new') {
              if (executionSessionId === '') {
                setDispatchError(t('execution.error.sessionRequired'))
                return
              }
              const session = executionContext?.sessions.find(
                (entry) => entry.sessionId === executionSessionId,
              )
              if (
                session === undefined ||
                !isSessionSuitableForStrategy(session, executionStrategy)
              ) {
                setDispatchError(t('execution.error.sessionUnsuitable'))
                return
              }
            }
            const sessions = ctx.get?.<ClientSessionsApi>('sessions')
            if (sessions === undefined) {
              setDispatchError(t('execution.dispatch.noService'))
              return
            }
            if (!currentConfirmGate()) {
              setDispatchError(dispatchGateMessage())
              return
            }

            if (dispatchLockRef.current) return
            dispatchLockRef.current = true
            setDispatchBusy(true)
            setDispatchError(null)
            setDispatchMessage(t('execution.dispatch.busy'))
            setDispatchCandidates(null)
            setReuseRecoveryConfirm(false)
            try {
              const outcome = await runDispatchFlow(
                { host: executionHostApi(), sessions },
                {
                  clientRequestId: newRequestId(),
                  todoId: executionTarget.id,
                  strategy: executionStrategy,
                  workspaceId: executionWorkspaceId,
                  ...(executionStrategy === 'new'
                    ? {}
                    : { sourceSessionId: executionSessionId }),
                },
              )
              if (outcome.execution !== undefined) setDispatchResult(outcome.execution)
              if (outcome.sessionId !== undefined) setDispatchSessionId(outcome.sessionId)
              if (outcome.status === 'error' && outcome.sessionId !== undefined) {
                const reuse =
                  (outcome.execution?.strategy ?? executionStrategy) === 'reuse'
                const actualError =
                  outcome.errorCode === undefined
                    ? t('execution.dispatch.error')
                    : messageForCode(t, outcome.errorCode)
                if (reuse) {
                  // Reuse never creates a Session: show the actual business
                  // error and offer source-Session recovery instead.
                  setDispatchMessage(t('execution.dispatch.reuseBindingFailed'))
                  setDispatchError(actualError)
                } else {
                  setDispatchError(
                    t('execution.dispatch.persistFailed').replace('{id}', outcome.sessionId),
                  )
                  setDispatchMessage(null)
                }
              } else if (outcome.status === 'accepted') {
                setDispatchMessage(t('execution.dispatch.accepted'))
              } else if (outcome.status === 'session_ready') {
                setDispatchMessage(t('execution.dispatch.sessionReady'))
                if (outcome.errorCode !== undefined) {
                  setDispatchError(messageForCode(t, outcome.errorCode))
                }
              } else if (outcome.status === 'dispatching') {
                setDispatchMessage(
                  outcome.errorCode === 'host_result_unavailable'
                    ? t('execution.dispatch.resultPending')
                    : outcome.errorCode === 'dispatch_lease_not_acquired'
                      ? t('execution.dispatch.leaseNotAcquired')
                      : t('execution.dispatch.dispatching'),
                )
                if (outcome.errorCode !== undefined && outcome.errorCode !== 'host_result_unavailable') {
                  setDispatchError(messageForCode(t, outcome.errorCode))
                }
              } else if (outcome.status === 'failed') {
                setDispatchMessage(t('execution.dispatch.failed'))
                if (outcome.errorCode !== undefined) {
                  setDispatchError(messageForCode(t, outcome.errorCode))
                }
              } else if (outcome.status === 'unknown') {
                setDispatchMessage(t('execution.dispatch.unknown'))
                if (outcome.errorCode !== undefined) {
                  setDispatchError(messageForCode(t, outcome.errorCode))
                }
              } else if (outcome.status === 'unavailable') {
                setDispatchMessage(null)
                setDispatchError(t('execution.dispatch.previewOnly'))
              } else {
                setDispatchMessage(null)
                if (outcome.errorCode !== undefined) {
                  setDispatchError(messageForCode(t, outcome.errorCode))
                } else {
                  setDispatchError(t('execution.dispatch.error'))
                }
              }
              if (outcome.errorCode === 'execution_unavailable') {
                setDispatchReady(false)
                setDispatchReason(messageForCode(t, outcome.errorCode))
              }
            } catch (error) {
              const code = errorCode(error)
              setDispatchMessage(null)
              setDispatchError(messageForCode(t, code))
              if (code === 'execution_unavailable') {
                // The Host cannot currently serve dispatch. Do not leave the
                // confirm button enabled on a stale capability state.
                setDispatchReady(false)
                setDispatchReason(messageForCode(t, code))
              }
              if (code === 'execution_unresolved' && executionTarget !== null) {
                // Surface the unresolved execution so the UI switches to
                // recovery actions instead of leaving "confirm" enabled.
                try {
                  const data = await callApi<{ executions: ClientExecutionRecord[] }>({
                    op: 'execution-status',
                    todoId: executionTarget.id,
                  })
                  const latest = data.executions[0]
                  if (latest !== undefined) {
                    setDispatchResult(latest)
                    setDispatchMessage(t('execution.dispatch.resumeRequired'))
                  }
                } catch {
                  // The error message above already explains the block.
                }
              }
            } finally {
              dispatchLockRef.current = false
              setDispatchBusy(false)
            }
          }

          async function resumeDispatch(): Promise<void> {
            const record = dispatchResult
            const sessions = ctx.get?.<ClientSessionsApi>('sessions')
            if (dispatchBusy || dispatchLockRef.current || record === null || sessions === undefined) return
            if (!currentSelectedGate()) {
              setDispatchError(dispatchGateMessage())
              return
            }
            dispatchLockRef.current = true
            setDispatchBusy(true)
            setDispatchError(null)
            setDispatchMessage(t('execution.dispatch.busy'))
            try {
              const outcome = await resumeDispatchFlow(
                { host: executionHostApi(), sessions },
                record,
              )
              if (outcome.execution !== undefined) setDispatchResult(outcome.execution)
              if (outcome.sessionId !== undefined) setDispatchSessionId(outcome.sessionId)
              setDispatchMessage(
                outcome.status === 'accepted'
                  ? t('execution.dispatch.accepted')
                  : outcome.status === 'dispatching'
                    ? outcome.errorCode === 'host_result_unavailable'
                      ? t('execution.dispatch.resultPending')
                      : outcome.errorCode === 'dispatch_lease_not_acquired'
                        ? t('execution.dispatch.leaseNotAcquired')
                        : t('execution.dispatch.dispatching')
                    : outcome.status === 'failed'
                      ? t('execution.dispatch.failed')
                      : t('execution.dispatch.unknown'),
              )
              if (outcome.errorCode === 'prompt_retry_not_authorized') {
                setDispatchMessage(t('execution.dispatch.promptRetryNotAuthorized'))
              }
              if (outcome.errorCode !== undefined) setDispatchError(messageForCode(t, outcome.errorCode))
            } catch (error) {
              setDispatchError(messageForCode(t, errorCode(error)))
            } finally {
              dispatchLockRef.current = false
              setDispatchBusy(false)
            }
          }

          async function abandonDispatch(): Promise<void> {
            const record = dispatchResult
            if (record === null || dispatchBusy) return
            if (!abandonConfirm) {
              setAbandonConfirm(true)
              setDispatchError(t('execution.dispatch.abandonWarning'))
              return
            }
            if (dispatchLockRef.current) return
            dispatchLockRef.current = true
            setDispatchBusy(true)
            setAbandonConfirm(false)
            try {
              const data = await callApi<{ execution: ClientExecutionRecord }>({
                op: 'execution-abandon',
                executionId: record.executionId,
              })
              setDispatchResult(data.execution)
              setDispatchCandidates(null)
              setDispatchMessage(t('execution.dispatch.abandoned'))
              setDispatchError(null)
            } catch (error) {
              setDispatchError(messageForCode(t, errorCode(error)))
            } finally {
              dispatchLockRef.current = false
              setDispatchBusy(false)
            }
          }

          function requestReuseRecovery(): void {
            if (dispatchBusy || dispatchResult === null) return
            if (!currentSelectedGate()) {
              setDispatchError(dispatchGateMessage())
              return
            }
            if (!reuseRecoveryConfirm) {
              setReuseRecoveryConfirm(true)
              setDispatchError(null)
              setDispatchMessage(t('execution.dispatch.reuseRecoverWarning'))
              return
            }
            setReuseRecoveryConfirm(false)
            void resumeDispatch()
          }

          async function checkDispatchStatus(): Promise<void> {
            const record = dispatchResult
            if (record === null || dispatchBusy || dispatchLockRef.current) return
            dispatchLockRef.current = true
            setDispatchBusy(true)
            try {
              const data = await callApi<{ execution: ClientExecutionRecord }>({
                op: 'execution-status',
                executionId: record.executionId,
              })
              setDispatchResult(data.execution)
              setDispatchMessage(
                data.execution.status === 'accepted'
                  ? t('execution.dispatch.accepted')
                  : data.execution.status === 'dispatching'
                    ? t('execution.dispatch.dispatching')
                    : t('execution.dispatch.unknown'),
              )
            } catch (error) {
              setDispatchError(messageForCode(t, errorCode(error)))
            } finally {
              dispatchLockRef.current = false
              setDispatchBusy(false)
            }
          }

          async function loadDispatchCandidates(): Promise<void> {
            const record = dispatchResult
            if (record === null || dispatchBusy) return
            setDispatchBusy(true)
            try {
              const data = await callApi<{ candidates: DispatchCandidate[] }>({
                op: 'execution-candidates',
                executionId: record.executionId,
              })
              setDispatchCandidates(data.candidates)
            } catch (error) {
              setDispatchError(messageForCode(t, errorCode(error)))
            } finally {
              setDispatchBusy(false)
            }
          }

          async function bindDispatchCandidate(sessionId: string): Promise<void> {
            const record = dispatchResult
            if (record === null || dispatchBusy) return
            setDispatchBusy(true)
            try {
              const data = await callApi<{ execution: ClientExecutionRecord }>({
                op: 'execution-bind',
                executionId: record.executionId,
                sessionId,
              })
              setDispatchResult(data.execution)
              setDispatchCandidates(null)
              setDispatchMessage(t('execution.dispatch.sessionReady'))
            } catch (error) {
              setDispatchError(messageForCode(t, errorCode(error)))
            } finally {
              setDispatchBusy(false)
            }
          }

          async function retryPersistSession(): Promise<void> {
            const record = dispatchResult
            const sessionId = dispatchSessionId
            const sessions = ctx.get?.<ClientSessionsApi>('sessions')
            if (record === null || sessionId === null || sessions === undefined || dispatchBusy || dispatchLockRef.current) return
            if (!currentSelectedGate()) {
              setDispatchError(dispatchGateMessage())
              return
            }
            dispatchLockRef.current = true
            setDispatchBusy(true)
            setDispatchError(null)
            try {
              if (record.strategy === 'reuse') {
                // Controlled source-Session recovery: no create/fork; the Host
                // re-checks the log and binds the original source Session.
                const recovery = await callApi<{
                  execution: ClientExecutionRecord
                  recovered: boolean
                }>({
                  op: 'execution-reuse-recover',
                  executionId: record.executionId,
                })
                setDispatchResult(recovery.execution)
                if (!recovery.recovered) {
                  setDispatchError(
                    messageForCode(t, recovery.execution.errorCode ?? 'reuse_recovery_unavailable'),
                  )
                  setDispatchMessage(t('execution.dispatch.reuseBindingFailed'))
                  return
                }
                if (recovery.execution.status === 'accepted') {
                  setDispatchMessage(t('execution.dispatch.accepted'))
                  return
                }
                const outcome = await continueDispatch(
                  { host: executionHostApi(), sessions },
                  recovery.execution,
                )
                if (outcome.execution !== undefined) setDispatchResult(outcome.execution)
                setDispatchMessage(
                  outcome.status === 'accepted'
                    ? t('execution.dispatch.accepted')
                    : t('execution.dispatch.sessionReady'),
                )
                if (outcome.errorCode !== undefined) {
                  setDispatchError(messageForCode(t, outcome.errorCode))
                }
                return
              }
              const ready = await callApi<{ execution: ClientExecutionRecord }>({
                op: 'execution-session',
                executionId: record.executionId,
                sessionId,
              })
              setDispatchResult(ready.execution)
              const outcome = await continueDispatch(
                { host: executionHostApi(), sessions },
                ready.execution,
              )
              if (outcome.execution !== undefined) setDispatchResult(outcome.execution)
              setDispatchMessage(
                outcome.status === 'accepted'
                  ? t('execution.dispatch.accepted')
                  : t('execution.dispatch.sessionReady'),
              )
            } catch (error) {
              setDispatchError(messageForCode(t, errorCode(error)))
            } finally {
              dispatchLockRef.current = false
              setDispatchBusy(false)
            }
          }

          function openTargetSession(): void {
            const sessionId = dispatchResult?.targetSessionId ?? dispatchSessionId
            if (sessionId === null || sessionId === undefined) return
            const uiWorkspace = ctx.get?.<{ openSession(id: string): void }>('uiWorkspace')
            if (uiWorkspace === undefined) {
              setDispatchError(t('execution.dispatch.openSession'))
              return
            }
            uiWorkspace.openSession(sessionId)
          }

          function closeExecution(): void {
            setExecutionTarget(null)
            setExecutionContext(null)
            setExecutionError(null)
            setExecutionNotice(null)
          }

          function onExecutionWorkspaceChange(workspaceId: string): void {
            setExecutionWorkspaceId(workspaceId)
            // A source session from the previous workspace is no longer valid.
            setExecutionSessionId('')
            setExecutionNotice(null)
          }

          function onExecutionStrategyChange(strategy: ExecutionStrategy): void {
            setExecutionStrategy(strategy)
            setExecutionSessionId('')
            setExecutionNotice(null)
          }

          function onExecutionSessionChange(sessionId: string): void {
            setExecutionSessionId(sessionId)
            setExecutionNotice(null)
          }

          function renderBanner(): unknown {
            if (banner === null) return null
            const success = banner.kind === 'success'
            return h(
              'div',
              {
                role: success ? 'status' : 'alert',
                style: success ? STYLES.successBanner : STYLES.errorBanner,
              },
              h('span', null, banner.message),
              h(
                'button',
                {
                  type: 'button',
                  'aria-label': t('banner.dismiss'),
                  title: t('banner.dismiss'),
                  onClick: () => setBanner(null),
                  style: STYLES.bannerDismiss,
                },
                svgIcon(14, ICON_X),
              ),
            )
          }

          function renderExecutionPanel(): unknown {
            if (executionTarget === null) return null
            const target = executionTarget
            const context = executionContext
            const workspace =
              context === null
                ? undefined
                : context.workspaces.find((entry) => entry.id === executionWorkspaceId)
            const sessionsInWorkspace =
              context === null
                ? []
                : dedupeExecutionSessions(
                    context.sessions.filter(
                      (session) => session.workspaceId === executionWorkspaceId,
                    ),
                  )
            const sessionIdLength = sessionLabelIdLength(sessionsInWorkspace)
            const strategySessions = sessionsInWorkspace.filter((session) =>
              isSessionSuitableForStrategy(session, executionStrategy),
            )
            const sourceSession = sessionsInWorkspace.find(
              (session) => session.sessionId === executionSessionId,
            )
            const sourceGate = selectedSourceSessionGate(
              sessionsInWorkspace,
              executionSessionId,
              executionStrategy,
            )
            const unsuitableCount = sessionsInWorkspace.length - strategySessions.length
            const unknownCount = sessionsInWorkspace.filter(
              (session) => session.blankState === 'unknown',
            ).length
            const dispatchAvailable = ctx.get?.<ClientSessionsApi>('sessions') !== undefined
            const unresolvedHistory = unresolvedExecutions(executionHistory)
            const workspaceReady = workspace !== undefined && workspace.available
            const confirmGate = canConfirmDispatch({
              strategy: executionStrategy,
              ...sourceGate,
              dispatchBusy,
              sessionApiAvailable: dispatchAvailable,
              historyPhase,
              dispatchReady,
              capabilityChecking,
              workspaceReady,
              hasUnresolvedExecution: unresolvedHistory.length > 0,
              hasCurrentExecution: dispatchResult !== null,
            })
            const selectedDispatchGate = canDispatchSelected({
              dispatchBusy,
              sessionApiAvailable: dispatchAvailable,
              historyPhase,
              dispatchReady,
              capabilityChecking,
              hasSelectedExecution: dispatchResult !== null,
            })

            function summaryRow(label: string, value: string): unknown {
              return h(
                'div',
                { style: STYLES.summaryRow },
                h('span', { style: STYLES.summaryKey }, label),
                h('span', { style: STYLES.summaryValue }, value),
              )
            }

            function actionButton(
              label: string,
              handler: () => void,
              disabled = false,
            ): unknown {
              return h(
                'button',
                {
                  type: 'button',
                  style: STYLES.secondaryButton,
                  onClick: handler,
                  disabled: disabled || dispatchBusy,
                },
                label,
              )
            }

            /** Readable label for a raw Session id without inventing a title. */
            function sessionReferenceLabel(sessionId: string | undefined): string {
              if (sessionId === undefined) return t('execution.summary.unset')
              const known = context?.sessions.find(
                (session) => session.sessionId === sessionId,
              )
              if (known !== undefined) {
                if (typeof known.title === 'string' && known.title.trim() !== '') {
                  return known.title
                }
                if (known.createdAt !== undefined) {
                  return `${shortSessionId(sessionId)} · ${formatCreatedAt(
                    new Date(known.createdAt).toISOString(),
                    dateLocale,
                  )}`
                }
              }
              return shortSessionId(sessionId)
            }

            function recordSessionRows(record: ClientExecutionRecord): unknown[] {
              const fields = executionSessionFields(record, dispatchSessionId ?? undefined)
              const targetValue =
                record.targetSessionId !== undefined
                  ? sessionReferenceLabel(record.targetSessionId)
                  : fields.target !== undefined
                    ? `${sessionReferenceLabel(fields.target)} ${t('execution.summary.pendingSave')}`
                    : t('execution.summary.notSaved')

              if (record.strategy === 'new') {
                return [summaryRow(t('execution.summary.targetSession'), targetValue)]
              }
              if (record.strategy === 'reuse') {
                if (fields.shared) {
                  return [
                    summaryRow(
                      t('execution.summary.sessionShared'),
                      sessionReferenceLabel(fields.source),
                    ),
                  ]
                }
                return [
                  summaryRow(
                    t('execution.summary.sourceSession'),
                    sessionReferenceLabel(fields.source),
                  ),
                  summaryRow(t('execution.summary.targetSession'), targetValue),
                ]
              }
              return [
                summaryRow(
                  t('execution.summary.sourceSession'),
                  sessionReferenceLabel(fields.source),
                ),
                summaryRow(t('execution.summary.targetSession'), targetValue),
              ]
            }

            function renderExecutionHistory(): unknown {
              const unresolved = unresolvedExecutions(executionHistory)
              const capabilityNotice =
                dispatchReady || capabilityChecking
                  ? null
                  : h(
                      'div',
                      null,
                      h(
                        'p',
                        { role: 'alert', style: STYLES.errorText },
                        t('execution.history.capabilityUnavailable').replace(
                          '{reason}',
                          dispatchReason ?? t('error.execution_unavailable'),
                        ),
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          style: { ...STYLES.secondaryButton, marginTop: '8px' },
                          onClick: () => void reloadExecutionState(),
                        },
                        t('execution.history.reload'),
                      ),
                    )
              if (historyPhase === 'idle' || historyLoading) {
                return h(
                  'div',
                  { style: STYLES.sectionBox },
                  h(
                    'div',
                    { style: { fontWeight: 600 } },
                    t('execution.history.title'),
                  ),
                  h('p', { style: STYLES.muted }, t('execution.history.loading')),
                )
              }
              if (historyPhase === 'error') {
                return h(
                  'div',
                  { style: STYLES.sectionBox },
                  h(
                    'div',
                    { style: { fontWeight: 600 } },
                    t('execution.history.title'),
                  ),
                  h(
                    'p',
                    { role: 'alert', style: STYLES.errorText },
                    historyError ?? t('error.unknown'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      style: { ...STYLES.secondaryButton, marginTop: '8px' },
                      onClick: () => void reloadExecutionState(),
                    },
                    t('execution.history.retry'),
                  ),
                )
              }
              if (unresolved.length === 0) {
                return h(
                  'div',
                  { style: STYLES.sectionBox },
                  h(
                    'div',
                    { style: STYLES.historyHeader },
                    h('div', { style: { fontWeight: 600 } }, t('execution.history.title')),
                    h('span', { style: STYLES.historyBadge }, '0'),
                  ),
                  h('p', { style: STYLES.hintText }, t('execution.history.empty')),
                  capabilityNotice,
                )
              }
              return h(
                'div',
                { style: STYLES.sectionBox },
                h(
                  'div',
                  { style: STYLES.historyHeader },
                  h('div', { style: { fontWeight: 600 } }, t('execution.history.title')),
                  h(
                    'span',
                    { style: STYLES.historyBadge },
                    t('execution.history.count').replace('{n}', String(unresolved.length)),
                  ),
                ),
                h('p', { style: STYLES.hintText }, t('execution.history.hint')),
                capabilityNotice,
                h(
                  'div',
                  { style: STYLES.historyList },
                  ...unresolved.map((record) =>
                    h(
                      'button',
                      {
                        key: record.executionId,
                        type: 'button',
                        style: {
                          ...STYLES.historyItem,
                          ...(record.executionId === selectedExecutionId
                            ? STYLES.historyItemSelected
                            : {}),
                        },
                        disabled: dispatchBusy,
                        onClick: () => selectExecution(record),
                      },
                      h(
                        'div',
                        { style: STYLES.historyRow },
                        h('span', { style: STYLES.historyId }, shortExecutionId(record.executionId)),
                        h(
                          'span',
                          { style: STYLES.historyBadge },
                          strategyLabel(t, record.strategy),
                        ),
                        h(
                          'span',
                          { style: STYLES.historyBadge },
                          describeDispatchStatus(record.status),
                        ),
                        record.executionId === selectedExecutionId
                          ? h(
                              'span',
                              { style: STYLES.historyBadge },
                              t('execution.history.selected'),
                            )
                          : null,
                      ),
                      h(
                        'div',
                        { style: STYLES.historyMeta },
                        `${t('execution.history.created')}: ${formatCreatedAt(
                          record.createdAt,
                          dateLocale,
                        )}`,
                      ),
                      record.sourceSessionId === undefined
                        ? null
                        : h(
                            'div',
                            { style: STYLES.historyMeta },
                            `${t('execution.summary.sourceSession')}: ${sessionReferenceLabel(
                              record.sourceSessionId,
                            )}`,
                          ),
                      h(
                        'div',
                        { style: STYLES.historyMeta },
                        `${t('execution.summary.targetSession')}: ${
                          record.targetSessionId === undefined
                            ? t('execution.summary.notSaved')
                            : sessionReferenceLabel(record.targetSessionId)
                        }`,
                      ),
                    ),
                  ),
                ),
              )
            }

            function renderDispatchStatus(): unknown {
              const record = dispatchResult
              if (record === null && dispatchError === null && dispatchMessage === null) return null
              const targetId = record?.targetSessionId ?? dispatchSessionId ?? undefined
              const buttons: unknown[] = []
              const unresolved =
                record !== null &&
                (record.status === 'prepared' ||
                  record.status === 'session_ready' ||
                  record.status === 'dispatching' ||
                  record.status === 'unknown')
              const abandonable =
                record !== null &&
                (record.status === 'prepared' ||
                  record.status === 'session_ready' ||
                  record.status === 'unknown')
              const reuseRecoverable =
                record !== null &&
                record.strategy === 'reuse' &&
                record.sourceSessionId !== undefined &&
                record.targetSessionId === undefined &&
                (record.status === 'prepared' ||
                  record.status === 'dispatching' ||
                  record.status === 'unknown')
              if (reuseRecoverable) {
                buttons.push(
                  actionButton(
                    reuseRecoveryConfirm
                      ? t('execution.dispatch.reuseRecoverConfirm')
                      : t('execution.dispatch.reuseRecoverContinue'),
                    requestReuseRecovery,
                    !selectedDispatchGate,
                  ),
                )
              }
              if (record?.status === 'prepared' && !reuseRecoverable) {
                buttons.push(
                  actionButton(
                    t('execution.dispatch.resume'),
                    () => void resumeDispatch(),
                    !selectedDispatchGate,
                  ),
                )
              }
              if (
                !reuseRecoverable &&
                targetId !== undefined &&
                record !== null &&
                (record.status === 'session_ready' ||
                  record.status === 'dispatching' ||
                  record.status === 'unknown')
              ) {
                buttons.push(
                  actionButton(t('execution.dispatch.check'), () => void checkDispatchStatus()),
                  actionButton(
                    t('execution.dispatch.continue'),
                    () => void resumeDispatch(),
                    !selectedDispatchGate,
                  ),
                )
              }
              if (
                record !== null &&
                record.strategy !== 'reuse' &&
                dispatchSessionId !== null &&
                dispatchError !== null
              ) {
                buttons.push(
                  actionButton(
                    t('execution.dispatch.persistFailed').replace('{id}', dispatchSessionId),
                    () => void retryPersistSession(),
                    !selectedDispatchGate,
                  ),
                )
              }
              if (record?.status === 'unknown' && record.strategy !== 'reuse') {
                buttons.push(
                  actionButton(t('execution.dispatch.candidates'), () => void loadDispatchCandidates()),
                )
              }
              if (unresolved) {
                if (abandonable) {
                  buttons.push(
                    actionButton(
                      abandonConfirm
                        ? t('execution.dispatch.abandonConfirm')
                        : t('execution.dispatch.abandon'),
                      () => void abandonDispatch(),
                    ),
                  )
                }
              }
              if (record?.status === 'failed' || (record === null && dispatchError !== null)) {
                buttons.push(
                  actionButton(t('execution.dispatch.retryNew'), () => {
                    setDispatchResult(null)
                    setDispatchSessionId(null)
                    setDispatchMessage(null)
                    setDispatchError(null)
                    setDispatchCandidates(null)
                    setAbandonConfirm(false)
                    setReuseRecoveryConfirm(false)
                    setExecutionNotice(null)
                  }),
                )
              }
              if (targetId !== undefined) {
                buttons.push(
                  actionButton(t('execution.dispatch.openSession'), openTargetSession),
                )
              }

              return h(
                'div',
                { style: STYLES.summaryBox },
                h('div', { style: { fontWeight: 600 } }, t('execution.dispatch.latest')),
                record === null
                  ? null
                  : summaryRow(
                      t('execution.summary.strategy'),
                      strategyLabel(t, record.strategy),
                    ),
                record === null
                  ? null
                  : summaryRow(t('execution.summary.status'), describeDispatchStatus(record.status)),
                ...(record === null ? [] : recordSessionRows(record)),
                record?.bindingSource === 'manual'
                  ? h('p', { style: STYLES.errorText }, t('execution.dispatch.manualBindingWarning'))
                  : null,
                unresolved
                  ? h('p', { style: STYLES.hintText }, t('execution.dispatch.resumeRequired'))
                  : null,
                dispatchMessage === null
                  ? null
                  : h('p', { style: STYLES.hintText }, dispatchMessage),
                record?.status === 'accepted'
                  ? h('p', { style: STYLES.hintText }, t('execution.dispatch.agentHint'))
                  : null,
                dispatchError === null
                  ? null
                  : h('p', { role: 'alert', style: STYLES.errorText }, dispatchError),
                buttons.length === 0
                  ? null
                  : h('div', { style: STYLES.formActions }, ...buttons),
                dispatchCandidates === null
                  ? null
                  : h(
                      'div',
                      null,
                      h('p', { style: STYLES.hintText }, t('execution.dispatch.candidateHint')),
                      dispatchCandidates.length === 0
                        ? h('p', { style: STYLES.hintText }, t('execution.dispatch.noCandidates'))
                        : null,
                      ...dispatchCandidates.map((candidate) =>
                        h(
                          'div',
                          { key: candidate.sessionId, style: STYLES.summaryRow },
                          h(
                            'span',
                            { style: STYLES.summaryValue },
                            [
                              candidate.title,
                              candidate.sessionId,
                              candidate.createdAt === undefined
                                ? null
                                : new Date(candidate.createdAt).toISOString(),
                            ]
                              .filter((part) => part !== undefined && part !== null && part !== '')
                              .join(' · '),
                          ),
                          h(
                            'button',
                            {
                              type: 'button',
                              style: STYLES.secondaryButton,
                              onClick: () => void bindDispatchCandidate(candidate.sessionId),
                              disabled: dispatchBusy,
                            },
                            t('execution.dispatch.bind'),
                          ),
                        ),
                      ),
                    ),
              )
            }

            function renderBody(): unknown {
              if (executionLoading) {
                return h('p', { style: STYLES.muted }, t('execution.loading'))
              }
              if (executionError !== null) {
                return h(
                  'div',
                  null,
                  h('p', { role: 'alert', style: STYLES.errorText }, messageForCode(t, executionError)),
                  h('button', {
                    type: 'button',
                    style: { ...STYLES.secondaryButton, marginTop: '12px' },
                    onClick: () => void loadExecutionContext(),
                  }, t('execution.retry')),
                )
              }
              if (context === null || !context.available) {
                return h('p', { role: 'alert', style: STYLES.errorText },
                  context?.reason ?? t('error.execution_unavailable'))
              }

              const strategies: ExecutionStrategy[] = ['new', 'reuse', 'fork']
              const strategyHint =
                executionStrategy === 'new'
                  ? t('execution.strategy.new.hint')
                  : executionStrategy === 'reuse'
                    ? t('execution.strategy.reuse.hint')
                    : t('execution.strategy.fork.hint')

              return h(
                'div',
                { className: 'dti-exec-layout' },
                h(
                  'div',
                  { className: 'dti-exec-config' },
                  h('label', {
                    htmlFor: 'task-inbox-exec-workspace',
                    style: STYLES.sectionLabel,
                  }, t('execution.workspace.label')),
                  h(
                    'select',
                    {
                      id: 'task-inbox-exec-workspace',
                      value: executionWorkspaceId,
                      style: STYLES.input,
                      onChange: (event: { target: { value: string } }) =>
                        onExecutionWorkspaceChange(event.target.value),
                    },
                    h('option', { value: '' }, t('execution.workspace.placeholder')),
                    ...context.workspaces.map((entry) =>
                      h('option', {
                        key: entry.id,
                        value: entry.id,
                        disabled: !entry.available,
                      }, entry.title + ' — ' + entry.path + (
                        entry.available ? '' : ' (' + t('execution.workspace.unavailable') + ')'
                      )),
                    ),
                  ),
                  context.workspaces.length === 0
                    ? h('p', { style: STYLES.hintText }, t('execution.workspace.empty'))
                    : null,
                  workspace !== undefined && !workspace.available
                    ? h('p', { style: STYLES.errorText }, t('execution.error.workspaceUnavailable'))
                    : null,
                  h('div', {
                    style: { ...STYLES.sectionLabel, marginTop: '18px' },
                  }, t('execution.strategy.label')),
                  h(
                    'div',
                    { style: STYLES.strategyGroup },
                    ...strategies.map((strategy) =>
                      h(
                        'button',
                        {
                          key: strategy,
                          type: 'button',
                          style: executionStrategy === strategy
                            ? STYLES.strategyButtonActive
                            : STYLES.strategyButton,
                          'aria-pressed': executionStrategy === strategy,
                          onClick: () => onExecutionStrategyChange(strategy),
                        },
                        strategyLabel(t, strategy),
                      ),
                    ),
                  ),
                  h('p', { style: STYLES.hintText }, strategyHint),
                  executionStrategy === 'new'
                    ? null
                    : h(
                        'div',
                        null,
                        h('label', {
                          htmlFor: 'task-inbox-exec-session',
                          style: STYLES.sectionLabel,
                        }, t('execution.session.label')),
                        h(
                          'select',
                          {
                            id: 'task-inbox-exec-session',
                            value: executionSessionId,
                            style: STYLES.input,
                            onChange: (event: { target: { value: string } }) =>
                              onExecutionSessionChange(event.target.value),
                          },
                          h('option', { value: '' }, t('execution.session.placeholder')),
                          ...sessionsInWorkspace.map((session) =>
                            h('option', {
                              key: session.sessionId,
                              value: session.sessionId,
                              disabled: !isSessionSuitableForStrategy(session, executionStrategy),
                            }, sessionDisplayLabel(t, session, sessionIdLength)),
                          ),
                        ),
                        sessionsInWorkspace.length === 0
                          ? h('p', { style: STYLES.hintText }, t('execution.session.empty'))
                          : null,
                        strategySessions.length === 0 && sessionsInWorkspace.length > 0
                          ? h('p', { style: STYLES.hintText }, t('execution.session.noneSuitable'))
                          : null,
                        unsuitableCount > 0
                          ? h('p', { style: STYLES.hintText },
                              t('execution.session.unavailableCount').replace('{n}', String(unsuitableCount)))
                          : null,
                        unknownCount > 0
                          ? h('p', { style: STYLES.hintText },
                              t('execution.session.unknownCount').replace('{n}', String(unknownCount)))
                          : null,
                        h('p', { style: STYLES.hintText }, t('execution.session.unknownHint')),
                        h('p', { style: STYLES.hintText }, t('execution.session.warningArchive')),
                        executionStrategy === 'fork'
                          ? h('p', { style: STYLES.hintText }, t('execution.session.warningFork'))
                          : null,
                      ),
                ),
                h(
                  'aside',
                  { className: 'dti-exec-summary' },
                  h(
                    'div',
                    { style: STYLES.summaryBox },
                    h('div', { style: { fontWeight: 500 } }, t('execution.summary.title')),
                    summaryRow(t('execution.summary.todo'), target.title),
                    summaryRow(
                      t('execution.summary.workspace'),
                      workspace === undefined
                        ? t('execution.summary.unset')
                        : workspace.title + ' — ' + workspace.path,
                    ),
                    summaryRow(t('execution.summary.strategy'), strategyLabel(t, executionStrategy)),
                    summaryRow(
                      t('execution.summary.session'),
                      executionStrategy === 'new'
                        ? t('execution.summary.newSession')
                        : sourceSession === undefined
                          ? t('execution.summary.unset')
                          : sessionDisplayLabel(t, sourceSession, sessionIdLength),
                    ),
                  ),
                  renderExecutionHistory(),
                  renderDispatchStatus(),
                  dispatchAvailable
                    ? null
                    : h('p', { style: STYLES.errorText }, t('execution.dispatch.previewOnly')),
                  executionNotice === null
                    ? null
                    : h('div', { role: 'status', style: STYLES.previewNotice }, executionNotice),
                ),
                h(
                  'div',
                  { className: 'dti-exec-actions', style: STYLES.formActions },
                  h('button', {
                    type: 'button',
                    style: STYLES.secondaryButton,
                    onClick: closeExecution,
                  }, t('execution.back')),
                  h('button', {
                    type: 'button',
                    style: {
                      ...STYLES.primaryButton,
                      ...(confirmGate ? {} : { opacity: 0.55, cursor: 'default' }),
                    },
                    onClick: () => void startDispatch(),
                    disabled: !confirmGate,
                    'aria-busy': dispatchBusy,
                  },
                    dispatchBusy
                      ? t('execution.dispatch.busy')
                      : dispatchAvailable
                        ? t('execution.dispatch.confirm')
                        : t('execution.confirm'),
                  ),
                ),
              )
            }

            return h(
              'div',
              {
                className: 'dti-execution-workspace',
                style: STYLES.executionPanel,
                onKeyDown: (event: { key?: string }) => {
                  if (event.key === 'Escape') closeExecution()
                },
              },
              h(
                'div',
                { style: STYLES.panelHeader },
                h(
                  'div',
                  { style: { minWidth: 0 } },
                  h('h2', { style: STYLES.cardTitle }, t('execution.panel.title')),
                  h(
                    'p',
                    { style: STYLES.hintText },
                    dispatchAvailable
                      ? t('execution.dispatch.intro')
                      : t('execution.preview.persistent'),
                  ),
                ),
                h(
                  'span',
                  { style: STYLES.executionBadge },
                  dispatchAvailable ? t('execution.dispatch.badge') : t('execution.preview.badge'),
                ),
              ),
              h(
                'div',
                { style: STYLES.sectionBox },
                h('div', { style: STYLES.label }, t('execution.todo.label')),
                h('div', { style: STYLES.rowTitle }, target.title),
                target.description === ''
                  ? null
                  : h('div', { style: STYLES.rowDescription }, target.description),
              ),
              renderBody(),
            )
          }

          function renderEditor(): unknown {
            if (editorMode === null) return null
            return h(
              'form',
              {
                style: STYLES.card,
                onSubmit: (event: { preventDefault(): void }) => {
                  event.preventDefault()
                  void submitEditor()
                },
                onKeyDown: (event: { key?: string }) => {
                  if (event.key === 'Escape') closeEditor()
                },
              },
              h(
                'h2',
                { style: STYLES.cardTitle },
                editorMode === 'edit' ? t('form.edit.title') : t('form.create.title'),
              ),
              h('label', { htmlFor: 'task-inbox-title', style: STYLES.label }, t('form.title.label')),
              h('input', {
                id: 'task-inbox-title',
                ref: titleInputRef,
                type: 'text',
                value: formTitle,
                placeholder: t('form.title.placeholder'),
                maxLength: TITLE_MAX_LENGTH,
                disabled: saving,
                style: STYLES.input,
                onChange: (event: { target: { value: string } }) => setFormTitle(event.target.value),
              }),
              h(
                'label',
                { htmlFor: 'task-inbox-description', style: { ...STYLES.label, marginTop: '12px' } },
                t('form.description.label'),
              ),
              h('textarea', {
                id: 'task-inbox-description',
                rows: 3,
                value: formDescription,
                placeholder: t('form.description.placeholder'),
                maxLength: DESCRIPTION_MAX_LENGTH,
                disabled: saving,
                style: { ...STYLES.input, resize: 'vertical', minHeight: '72px' },
                onChange: (event: { target: { value: string } }) =>
                  setFormDescription(event.target.value),
              }),
              formError === null
                ? null
                : h('p', { role: 'alert', style: STYLES.errorText }, formError),
              h(
                'div',
                { style: STYLES.formActions },
                h(
                  'button',
                  {
                    type: 'button',
                    style: STYLES.secondaryButton,
                    onClick: closeEditor,
                    disabled: saving,
                  },
                  t('form.cancel'),
                ),
                h(
                  'button',
                  {
                    type: 'submit',
                    style: {
                      ...STYLES.primaryButton,
                      ...(saving ? { opacity: 0.6, cursor: 'default' } : {}),
                    },
                    disabled: saving,
                    'aria-busy': saving,
                  },
                  saving ? t('form.saving') : t('form.save'),
                ),
              ),
            )
          }

          function latestExecutionForTodo(todoId: string): ClientExecutionOverviewRecord | undefined {
            return executionOverview
              .filter((record) => record.todoId === todoId)
              .sort((left, right) => right.createdAtMs - left.createdAtMs)[0]
          }

          function unresolvedExecutionForTodo(todoId: string): ClientExecutionOverviewRecord | undefined {
            return executionOverview
              .filter((record) => record.todoId === todoId && UNRESOLVED_EXECUTION_STATUSES.includes(record.status))
              .sort((left, right) => right.createdAtMs - left.createdAtMs)[0]
          }

          function workspaceLabel(record: ClientExecutionOverviewRecord): string {
            const parts = record.workspacePath.split(/[\\/]+/).filter(Boolean)
            return parts[parts.length - 1] ?? record.workspacePath
          }

          function getVisibleTodos(): Todo[] {
            const query = searchQuery.trim().toLocaleLowerCase()
            const overviewReady = overviewPhase === 'loaded'
            const filtered = todos.filter((todo) => {
              if (query !== '' && !todo.title.toLocaleLowerCase().includes(query) &&
                !todo.description.toLocaleLowerCase().includes(query)) return false

              if (!overviewReady && (statusFilter !== 'all' || workspaceFilter !== '' || strategyFilter !== 'all')) {
                return false
              }

              const records = executionOverview.filter((record) => record.todoId === todo.id)
              const latest = latestExecutionForTodo(todo.id)
              if (statusFilter === 'undispatched' && records.length !== 0) return false
              if (statusFilter === 'unresolved' && !records.some((record) => UNRESOLVED_EXECUTION_STATUSES.includes(record.status))) return false
              if (statusFilter === 'accepted' && latest?.status !== 'accepted') return false
              if (workspaceFilter === '__unassigned__' && latest !== undefined) return false
              if (workspaceFilter !== '' && workspaceFilter !== '__unassigned__' && latest?.workspaceId !== workspaceFilter) return false
              if (strategyFilter !== 'all' && latest?.strategy !== strategyFilter) return false
              return true
            })

            if (sortMode === 'created') {
              return filtered.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
            }
            if (sortMode === 'recent') {
              return filtered.sort((left, right) => {
                const leftTime = Math.max(Date.parse(left.updatedAt), Date.parse(latestExecutionForTodo(left.id)?.updatedAt ?? left.updatedAt))
                const rightTime = Math.max(Date.parse(right.updatedAt), Date.parse(latestExecutionForTodo(right.id)?.updatedAt ?? right.updatedAt))
                return rightTime - leftTime
              })
            }
            return sortTodos(filtered)
          }

          function renderOverview(): unknown {
            const undispatched = overviewPhase === 'loaded'
              ? todos.filter((todo) => !executionOverview.some((record) => record.todoId === todo.id)).length
              : '—'
            const unresolved = overviewPhase === 'loaded'
              ? todos.filter((todo) => unresolvedExecutionForTodo(todo.id) !== undefined).length
              : '—'
            const accepted = overviewPhase === 'loaded'
              ? todos.filter((todo) => latestExecutionForTodo(todo.id)?.status === 'accepted').length
              : '—'
            const stats = [
              [t('workbench.stats.total'), String(todos.length)],
              [t('workbench.stats.undispatched'), String(undispatched)],
              [t('workbench.stats.unresolved'), String(unresolved)],
              [t('workbench.stats.accepted'), String(accepted)],
            ]
            return h(
              'div',
              null,
              overviewPhase === 'error'
                ? h(
                    'div',
                    { className: 'dti-overview-error', role: 'alert' },
                    overviewError ?? t('error.unknown'),
                    ' ',
                    h('button', {
                      type: 'button',
                      className: 'dti-small-button',
                      onClick: () => void loadExecutionOverview(),
                    }, t('workbench.detail.retry')),
                  )
                : null,
              h(
                'div',
                { className: 'dti-stat-grid' },
                ...stats.map(([label, value]) =>
                  h(
                    'div',
                    { key: label, className: 'dti-stat' },
                    h('div', { className: 'dti-stat-label' }, label),
                    h('div', { className: 'dti-stat-value' }, value),
                  ),
                ),
              ),
            )
          }

          function renderToolbar(): unknown {
            const workspaceOptions = new Map<string, string>()
            for (const record of todos
              .map((todo) => latestExecutionForTodo(todo.id))
              .filter((record): record is ClientExecutionOverviewRecord => record !== undefined)) {
              if (!workspaceOptions.has(record.workspaceId)) workspaceOptions.set(record.workspaceId, workspaceLabel(record))
            }
            return h(
              'div',
              { className: 'dti-toolbar' },
              h('input', {
                className: 'dti-control dti-search',
                type: 'search',
                value: searchQuery,
                placeholder: t('workbench.search.placeholder'),
                'aria-label': t('workbench.search.placeholder'),
                onChange: (event: { target: { value: string } }) => setSearchQuery(event.target.value),
              }),
              h(
                'select',
                {
                  className: 'dti-control',
                  value: statusFilter,
                  'aria-label': t('workbench.filter.status'),
                  disabled: overviewPhase !== 'loaded',
                  onChange: (event: { target: { value: string } }) =>
                    setStatusFilter(event.target.value as typeof statusFilter),
                },
                h('option', { value: 'all' }, t('workbench.filter.all')),
                h('option', { value: 'undispatched' }, t('workbench.filter.undispatched')),
                h('option', { value: 'unresolved' }, t('workbench.filter.unresolved')),
                h('option', { value: 'accepted' }, t('workbench.filter.accepted')),
              ),
              h(
                'select',
                {
                  className: 'dti-control',
                  value: workspaceFilter,
                  'aria-label': t('workbench.filter.workspace'),
                  disabled: overviewPhase !== 'loaded',
                  onChange: (event: { target: { value: string } }) => setWorkspaceFilter(event.target.value),
                },
                h('option', { value: '' }, t('workbench.filter.allWorkspaces')),
                h('option', { value: '__unassigned__' }, t('workbench.filter.unassigned')),
                ...[...workspaceOptions.entries()].sort((left, right) => left[1].localeCompare(right[1])).map(([id, label]) =>
                  h('option', { key: id, value: id }, label),
                ),
              ),
              h(
                'select',
                {
                  className: 'dti-control',
                  value: strategyFilter,
                  'aria-label': t('workbench.filter.strategy'),
                  disabled: overviewPhase !== 'loaded',
                  onChange: (event: { target: { value: string } }) =>
                    setStrategyFilter(event.target.value as typeof strategyFilter),
                },
                h('option', { value: 'all' }, t('workbench.filter.allStrategies')),
                h('option', { value: 'new' }, strategyLabel(t, 'new')),
                h('option', { value: 'reuse' }, strategyLabel(t, 'reuse')),
                h('option', { value: 'fork' }, strategyLabel(t, 'fork')),
              ),
              h(
                'select',
                {
                  className: 'dti-control',
                  value: sortMode,
                  'aria-label': t('workbench.sort.label'),
                  onChange: (event: { target: { value: string } }) =>
                    setSortMode(event.target.value as typeof sortMode),
                },
                h('option', { value: 'manual' }, t('workbench.sort.manual')),
                h('option', { value: 'recent' }, t('workbench.sort.recent')),
                h('option', { value: 'created' }, t('workbench.sort.created')),
              ),
            )
          }

          function renderRow(todo: Todo, index: number, visibleTodos: Todo[]): unknown {
            const busy = busyId === todo.id
            const confirming = confirmId === todo.id
            const latest = latestExecutionForTodo(todo.id)
            const unresolved = unresolvedExecutionForTodo(todo.id)
            const status = unresolved?.status ?? latest?.status ?? 'undispatched'
            const selected = selectedTodoId === todo.id
            const canReorder =
              sortMode === 'manual' &&
              searchQuery.trim() === '' &&
              statusFilter === 'all' &&
              workspaceFilter === '' &&
              strategyFilter === 'all'

            const actions = confirming
              ? h(
                  'div',
                  { className: 'dti-task-actions', onKeyDown: (event: { key?: string }) => {
                    if (event.key === 'Escape') setConfirmId(null)
                  } },
                  h('span', { style: STYLES.confirmText }, t('list.confirmDelete')),
                  h('button', {
                    type: 'button',
                    className: 'dti-danger-button',
                    onClick: () => void removeTodo(todo.id),
                    disabled: busy,
                    'aria-busy': busy,
                  }, busy ? t('form.saving') : t('list.deleteConfirm')),
                  h('button', {
                    type: 'button',
                    className: 'dti-small-button',
                    onClick: () => setConfirmId(null),
                    disabled: busy,
                  }, t('list.deleteCancel')),
                )
              : h(
                  'div',
                  { className: 'dti-task-actions' },
                  iconButton(t('execution.action'), ICON_PLAY, () => openExecution(todo), { disabled: busy }),
                  canReorder
                    ? iconButton(t('list.moveUp'), ICON_UP, () => void moveTodo(todo.id, 'up'), {
                        disabled: index === 0 || busy,
                      })
                    : null,
                  canReorder
                    ? iconButton(t('list.moveDown'), ICON_DOWN, () => void moveTodo(todo.id, 'down'), {
                        disabled: index === visibleTodos.length - 1 || busy,
                      })
                    : null,
                  iconButton(t('list.edit'), ICON_EDIT, () => openEdit(todo), { disabled: busy }),
                  iconButton(t('list.delete'), ICON_TRASH, () => setConfirmId(todo.id), {
                    disabled: busy,
                    danger: true,
                  }),
                )

            const metadata = [
              latest === undefined ? t('workbench.detail.unassigned') : workspaceLabel(latest),
              latest === undefined ? null : strategyLabel(t, latest.strategy),
              latest?.targetSessionId === undefined ? null : shortSessionId(latest.targetSessionId),
            ].filter((value): value is string => value !== null && value !== undefined)

            return h(
              'div',
              {
                key: todo.id,
                className: 'dti-task-row' + (selected ? ' is-selected' : ''),
              },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dti-task-select',
                  onClick: () => setSelectedTodoId(todo.id),
                  'aria-pressed': selected,
                },
                h('span', { className: 'dti-task-title' }, todo.title),
                todo.description === ''
                  ? null
                  : h('span', { className: 'dti-task-description' }, todo.description),
                h(
                  'span',
                  { className: 'dti-task-meta' },
                  h('span', null, t('list.createdAt').replace('{time}', formatCreatedAt(todo.createdAt, dateLocale))),
                  ...metadata.map((value, metaIndex) => h('span', { key: metaIndex }, value)),
                  h('span', { className: 'dti-status dti-status-' + status }, workbenchStatusLabel(status)),
                ),
              ),
              actions,
            )
          }

          function workbenchStatusLabel(status: string): string {
            const key = 'workbench.status.' + status
            const label = t(key)
            return label === key ? describeDispatchStatus(status) : label
          }

          function renderEmpty(): unknown {
            return h(
              'div',
              { style: STYLES.emptyCard },
              h('div', { style: STYLES.emptyIcon }, h(TaskInboxIcon, { size: 28, active: false })),
              h('h2', { style: STYLES.emptyTitle }, t('list.empty.title')),
              h('p', { style: STYLES.emptyText }, t('list.empty.description')),
              h('button', {
                type: 'button',
                className: 'dti-primary-button',
                onClick: openCreate,
              }, t('list.empty.action')),
            )
          }

          function renderList(): unknown {
            if (loading) {
              return h('div', { style: STYLES.card }, h('p', { style: STYLES.muted }, t('list.loading')))
            }
            if (loadError !== null) {
              return h(
                'div',
                { style: STYLES.card },
                h('p', { role: 'alert', style: STYLES.errorText },
                  loadError === 'unknown' || loadError === '' ? t('error.loadFailed') : messageForCode(t, loadError)),
                h('button', {
                  type: 'button',
                  className: 'dti-small-button',
                  onClick: () => void load(),
                }, t('list.retry')),
              )
            }
            if (todos.length === 0) return renderEmpty()
            const visibleTodos = getVisibleTodos()
            if (visibleTodos.length === 0) {
              return h(
                'div',
                { className: 'dti-task-list' },
                h('div', { className: 'dti-empty-filter' },
                  t('workbench.list.noResults'),
                  h('div', { style: { marginTop: '10px' } },
                    h('button', { type: 'button', className: 'dti-small-button', onClick: clearWorkbenchFilters },
                      t('workbench.list.clearFilters')),
                  ),
                ),
              )
            }
            return h(
              'div',
              null,
              h('div', { style: STYLES.count },
                t('workbench.list.count')
                  .replace('{visible}', String(visibleTodos.length))
                  .replace('{total}', String(todos.length))),
              h('div', { className: 'dti-task-list' },
                ...visibleTodos.map((todo, index) => renderRow(todo, index, visibleTodos))),
            )
          }

          function renderDetailPanel(): unknown {
            const todo = todos.find((entry) => entry.id === selectedTodoId)
            if (todo === undefined) {
              return h('aside', { className: 'dti-detail-pane' },
                h('h2', { className: 'dti-detail-title' }, t('workbench.detail.title')),
                h('p', { className: 'dti-detail-description' }, t('workbench.detail.selectHint')),
              )
            }

            const latest = latestExecutionForTodo(todo.id)
            const confirming = confirmId === todo.id
            const history = detailExecutions.slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt))
            const detailActions = confirming
              ? h('div', { className: 'dti-detail-actions' },
                  h('span', { style: STYLES.confirmText }, t('list.confirmDelete')),
                  h('button', { type: 'button', className: 'dti-danger-button', onClick: () => void removeTodo(todo.id), disabled: busyId === todo.id }, t('list.deleteConfirm')),
                  h('button', { type: 'button', className: 'dti-small-button', onClick: () => setConfirmId(null), disabled: busyId === todo.id }, t('list.deleteCancel')),
                )
              : h('div', { className: 'dti-detail-actions' },
                  h('button', { type: 'button', className: 'dti-primary-button', onClick: () => openExecution(todo) }, t('workbench.detail.execute')),
                  h('button', { type: 'button', className: 'dti-small-button', onClick: () => openEdit(todo) }, t('workbench.detail.edit')),
                  h('button', { type: 'button', className: 'dti-small-button', onClick: () => setConfirmId(todo.id) }, t('workbench.detail.delete')),
                )

            function detailMeta(label: string, value: string): unknown {
              return h('div', { className: 'dti-detail-meta-pair' },
                h('div', { className: 'dti-detail-key' }, label),
                h('div', { className: 'dti-detail-value' }, value),
              )
            }

            function renderHistoryRecord(record: ClientExecutionRecord): unknown {
              const expanded = expandedExecutionId === record.executionId
              const sessionId = record.targetSessionId ?? record.sourceSessionId
              const events = record.events ?? []
              const canRecover = isUnresolvedExecution(record)
              return h(
                'div',
                { key: record.executionId, className: 'dti-history-item' },
                h('div', { className: 'dti-history-top' },
                  h('div', null,
                    h('div', { className: 'dti-history-id' }, shortExecutionId(record.executionId)),
                    h('span', { className: 'dti-status dti-status-' + record.status }, workbenchStatusLabel(record.status)),
                  ),
                  h('button', {
                    type: 'button',
                    className: 'dti-small-button',
                    onClick: () => setExpandedExecutionId(expanded ? null : record.executionId),
                    'aria-expanded': expanded,
                  }, expanded ? '−' : '+'),
                ),
                h('div', { className: 'dti-detail-meta', style: { marginTop: '8px' } },
                  detailMeta(t('workbench.detail.workspace'), record.workspacePath.split(/[\\/]+/).filter(Boolean).pop() ?? record.workspacePath),
                  detailMeta(t('workbench.detail.strategy'), strategyLabel(t, record.strategy)),
                  detailMeta(t('workbench.detail.session'), sessionId === undefined ? t('execution.summary.unset') : shortSessionId(sessionId)),
                ),
                expanded
                  ? h('div', null,
                      events.length === 0
                        ? h('p', { className: 'dti-detail-description' }, t('workbench.detail.noEvents'))
                        : h('div', { className: 'dti-history-events' },
                            ...events.map((event) => {
                              const key = 'workbench.event.' + event.kind
                              const label = t(key)
                              return h('div', { key: event.eventId, className: 'dti-history-event' },
                                h('span', { className: 'dti-history-dot' }),
                                h('div', null,
                                  h('div', { className: 'dti-history-event-title' }, label === key ? event.kind : label),
                                  h('div', { className: 'dti-history-event-time' }, formatCreatedAt(event.at, dateLocale)),
                                  event.errorCode === undefined ? null : h('div', { className: 'dti-history-event-time' }, event.errorCode),
                                ),
                              )
                            }),
                          ),
                      canRecover
                        ? h('div', { className: 'dti-history-footer' },
                            h('button', { type: 'button', className: 'dti-small-button', onClick: () => { if (todo !== undefined) openExecution(todo, record.executionId) } },
                              t('workbench.detail.openExecution')),
                          )
                        : null,
                    )
                  : null,
              )
            }

            return h(
              'aside',
              { className: 'dti-detail-pane' },
              h('div', { className: 'dti-detail-header' },
                h('h2', { className: 'dti-detail-title' }, t('workbench.detail.title')),
                h('span', { className: 'dti-status dti-status-' + (latest?.status ?? 'undispatched') },
                  workbenchStatusLabel(latest?.status ?? 'undispatched')),
              ),
              h('p', { className: 'dti-detail-title', style: { marginTop: '13px' } }, todo.title),
              todo.description === '' ? null : h('p', { className: 'dti-detail-description' }, todo.description),
              detailActions,
              h('div', { className: 'dti-detail-section' },
                h('h3', { className: 'dti-detail-section-title' }, t('workbench.detail.title')),
                h('div', { className: 'dti-detail-meta' },
                  detailMeta(t('workbench.detail.createdAt'), formatCreatedAt(todo.createdAt, dateLocale)),
                  detailMeta(t('workbench.detail.updatedAt'), formatCreatedAt(todo.updatedAt, dateLocale)),
                ),
              ),
              h('div', { className: 'dti-detail-section' },
                h('h3', { className: 'dti-detail-section-title' }, t('workbench.detail.latestExecution')),
                latest === undefined
                  ? h('p', { className: 'dti-detail-description' }, overviewPhase === 'error' ? (overviewError ?? t('error.unknown')) : t('workbench.detail.noExecution'))
                  : h('div', { className: 'dti-detail-meta' },
                      detailMeta(t('workbench.detail.workspace'), workspaceLabel(latest)),
                      detailMeta(t('workbench.detail.strategy'), strategyLabel(t, latest.strategy)),
                      detailMeta(t('workbench.detail.session'), latest.targetSessionId ?? latest.sourceSessionId
                        ? shortSessionId((latest.targetSessionId ?? latest.sourceSessionId) as string)
                        : t('execution.summary.unset')),
                      detailMeta(t('workbench.detail.status'), workbenchStatusLabel(latest.status)),
                    ),
              ),
              h('div', { className: 'dti-detail-section' },
                h('h3', { className: 'dti-detail-section-title' }, t('workbench.detail.history')),
                detailHistoryPhase === 'loading'
                  ? h('p', { className: 'dti-detail-description' }, t('workbench.detail.historyLoading'))
                  : detailHistoryPhase === 'error'
                    ? h('div', null,
                        h('p', { role: 'alert', className: 'dti-detail-description' }, detailHistoryError ?? t('workbench.detail.historyError')),
                        h('button', { type: 'button', className: 'dti-small-button', onClick: () => void loadDetailHistory(todo.id) }, t('workbench.detail.retry')),
                      )
                    : history.length === 0
                      ? h('p', { className: 'dti-detail-description' }, t('workbench.detail.noExecution'))
                      : h('div', null, ...history.map(renderHistoryRecord)),
              ),
            )
          }

          const addButtonDisabled = editorMode !== null || saving || executionTarget !== null
          return h(
            'section',
            { style: STYLES.page, 'data-dsh-plugin': PACKAGE_ID },
            h('style', null, WORKBENCH_CSS),
            h(
              'div',
              { style: { ...STYLES.frame, maxWidth: '1440px', width: '100%' } },
              h(
                'header',
                { style: STYLES.header },
                h(
                  'div',
                  { style: STYLES.headerText },
                  h('h1', { style: STYLES.title }, t('page.title')),
                  h('p', { style: STYLES.subtitle }, t('page.subtitle')),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dti-primary-button',
                    onClick: openCreate,
                    disabled: addButtonDisabled,
                  },
                  svgIcon(14, ICON_PLUS),
                  h('span', null, t('add.button')),
                ),
              ),
              renderBanner(),
              executionTarget === null ? renderEditor() : null,
              executionTarget === null
                ? h(
                    'div',
                    { className: 'dti-workbench' },
                    h(
                      'main',
                      { className: 'dti-workbench-main' },
                      renderOverview(),
                      renderToolbar(),
                      h('h2', { className: 'dti-detail-section-title', style: { marginBottom: '9px' } }, t('workbench.list.title')),
                      renderList(),
                    ),
                    renderDetailPanel(),
                  )
                : renderExecutionPanel(),
            ),
          )
        }

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 20,
              label: () => t('panel.label'),
            },
            TaskInboxIcon,
          ),
        )

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, TaskInboxPage),
        )

        function t(key: string): string {
          return ctx.locale.bind(LOCALE_NS)(key)
        }
      },
    }
  },
})
