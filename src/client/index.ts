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
    'execution.dispatch.promptRetryNotAuthorized':
      'The Host did not authorize a Prompt retry. Check status/candidates manually; do not create a new Session.',
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
    'execution.dispatch.promptRetryNotAuthorized':
      'Host 未授权本次 Prompt 重试。请手动检查状态/候选会话；不要创建新会话。',
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

function strategyLabel(t: Translate, strategy: ExecutionStrategy): string {
  if (strategy === 'reuse') return t('execution.strategy.reuse')
  if (strategy === 'fork') return t('execution.strategy.fork')
  return t('execution.strategy.new')
}

function sessionDisplayLabel(t: Translate, session: ExecutionSession): string {
  const title =
    typeof session.title === 'string' && session.title.trim() !== ''
      ? session.title
      : t('execution.titleUnknown')
  const flags: string[] = []
  if (session.blankState === 'blank') flags.push(t('execution.session.blank'))
  if (session.blankState === 'unknown') flags.push(t('execution.session.stateUnknown'))
  if (!session.stored) flags.push(t('execution.session.notFound'))
  else if (session.live) flags.push(t('execution.session.live'))
  return flags.length === 0 ? title : `${title} (${flags.join(', ')})`
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
}

;(window as unknown as { __DSH_TASK_INBOX_TEST__?: TaskInboxTestHooks }).__DSH_TASK_INBOX_TEST__ = {
  runDispatchFlow,
  resumeDispatchFlow,
  continueDispatch,
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
          const titleInputRef = React.useRef<{ focus(): void } | null>(null)

          React.useEffect(() => {
            const controller = new AbortController()
            void load(controller.signal)
            return () => controller.abort()
          }, [])

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

          function openExecution(todo: Todo): void {
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
            setDispatchResult(null)
            setDispatchSessionId(null)
            setDispatchMessage(null)
            setDispatchError(null)
            setDispatchCandidates(null)
            setAbandonConfirm(false)
            void loadExecutionContext()
            void loadLatestExecution(todo.id)
          }

          async function loadLatestExecution(todoId: string): Promise<void> {
            try {
              const data = await callApi<{ executions: ClientExecutionRecord[] }>({
                op: 'execution-status',
                todoId,
              })
              const latest = data.executions[0]
              if (latest !== undefined && latest.status !== 'accepted') {
                setDispatchResult(latest)
                setDispatchMessage(t('execution.dispatch.resumeHint'))
              }
            } catch {
              // Execution history is optional; the preview can still run.
            }
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

            setDispatchBusy(true)
            setDispatchError(null)
            setDispatchMessage(t('execution.dispatch.busy'))
            setDispatchCandidates(null)
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
                setDispatchError(
                  t('execution.dispatch.persistFailed').replace('{id}', outcome.sessionId),
                )
                setDispatchMessage(null)
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
            } catch (error) {
              const code = errorCode(error)
              setDispatchMessage(null)
              setDispatchError(messageForCode(t, code))
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
              setDispatchBusy(false)
            }
          }

          async function resumeDispatch(): Promise<void> {
            const record = dispatchResult
            const sessions = ctx.get?.<ClientSessionsApi>('sessions')
            if (dispatchBusy || record === null || sessions === undefined) return
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
              setDispatchBusy(false)
            }
          }

          async function checkDispatchStatus(): Promise<void> {
            const record = dispatchResult
            if (record === null || dispatchBusy) return
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
            if (record === null || sessionId === null || sessions === undefined || dispatchBusy) return
            setDispatchBusy(true)
            setDispatchError(null)
            try {
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
                : context.sessions.filter(
                    (session) => session.workspaceId === executionWorkspaceId,
                  )
            const strategySessions = sessionsInWorkspace.filter((session) =>
              isSessionSuitableForStrategy(session, executionStrategy),
            )
            const sourceSession = sessionsInWorkspace.find(
              (session) => session.sessionId === executionSessionId,
            )
            const unsuitableCount = sessionsInWorkspace.length - strategySessions.length
            const unknownCount = sessionsInWorkspace.filter(
              (session) => session.blankState === 'unknown',
            ).length
            const dispatchAvailable = ctx.get?.<ClientSessionsApi>('sessions') !== undefined

            function summaryRow(label: string, value: string): unknown {
              return h(
                'div',
                { style: STYLES.summaryRow },
                h('span', { style: STYLES.summaryKey }, label),
                h('span', { style: STYLES.summaryValue }, value),
              )
            }

            function actionButton(label: string, handler: () => void): unknown {
              return h(
                'button',
                {
                  type: 'button',
                  style: STYLES.secondaryButton,
                  onClick: handler,
                  disabled: dispatchBusy,
                },
                label,
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
              if (record?.status === 'prepared') {
                buttons.push(
                  actionButton(t('execution.dispatch.resume'), () => void resumeDispatch()),
                )
              }
              if (
                targetId !== undefined &&
                record !== null &&
                (record.status === 'session_ready' ||
                  record.status === 'dispatching' ||
                  record.status === 'unknown')
              ) {
                buttons.push(
                  actionButton(t('execution.dispatch.check'), () => void checkDispatchStatus()),
                  actionButton(t('execution.dispatch.continue'), () => void resumeDispatch()),
                )
              }
              if (dispatchSessionId !== null && dispatchError !== null && record !== null) {
                buttons.push(
                  actionButton(t('execution.dispatch.persistFailed').replace('{id}', dispatchSessionId), () =>
                    void retryPersistSession(),
                  ),
                )
              }
              if (record?.status === 'unknown') {
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
                targetId === undefined
                  ? null
                  : summaryRow(t('execution.summary.session'), targetId),
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
                  h(
                    'p',
                    { role: 'alert', style: STYLES.errorText },
                    messageForCode(t, executionError),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      style: { ...STYLES.secondaryButton, marginTop: '12px' },
                      onClick: () => void loadExecutionContext(),
                    },
                    t('execution.retry'),
                  ),
                )
              }
              if (context === null || !context.available) {
                return h(
                  'p',
                  { role: 'alert', style: STYLES.errorText },
                  context?.reason ?? t('error.execution_unavailable'),
                )
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
                null,
                h(
                  'label',
                  { htmlFor: 'task-inbox-exec-workspace', style: STYLES.sectionLabel },
                  t('execution.workspace.label'),
                ),
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
                    h(
                      'option',
                      { key: entry.id, value: entry.id, disabled: !entry.available },
                      `${entry.title} — ${entry.path}${
                        entry.available ? '' : ` (${t('execution.workspace.unavailable')})`
                      }`,
                    ),
                  ),
                ),
                context.workspaces.length === 0
                  ? h('p', { style: STYLES.hintText }, t('execution.workspace.empty'))
                  : null,
                workspace !== undefined && !workspace.available
                  ? h('p', { style: STYLES.errorText }, t('execution.error.workspaceUnavailable'))
                  : null,

                h('div', { style: { ...STYLES.sectionLabel, marginTop: '16px' } }, t('execution.strategy.label')),
                h(
                  'div',
                  { style: STYLES.strategyGroup },
                  ...strategies.map((strategy) =>
                    h(
                      'button',
                      {
                        key: strategy,
                        type: 'button',
                        style:
                          executionStrategy === strategy
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
                      h(
                        'label',
                        { htmlFor: 'task-inbox-exec-session', style: STYLES.sectionLabel },
                        t('execution.session.label'),
                      ),
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
                          h(
                            'option',
                            {
                              key: session.sessionId,
                              value: session.sessionId,
                              disabled: !isSessionSuitableForStrategy(session, executionStrategy),
                            },
                            sessionDisplayLabel(t, session),
                          ),
                        ),
                      ),
                      sessionsInWorkspace.length === 0
                        ? h('p', { style: STYLES.hintText }, t('execution.session.empty'))
                        : null,
                      strategySessions.length === 0 && sessionsInWorkspace.length > 0
                        ? h('p', { style: STYLES.hintText }, t('execution.session.noneSuitable'))
                        : null,
                      unsuitableCount > 0
                        ? h(
                            'p',
                            { style: STYLES.hintText },
                            t('execution.session.unavailableCount').replace(
                              '{n}',
                              String(unsuitableCount),
                            ),
                          )
                        : null,
                      unknownCount > 0
                        ? h(
                            'p',
                            { style: STYLES.hintText },
                            t('execution.session.unknownCount').replace(
                              '{n}',
                              String(unknownCount),
                            ),
                          )
                        : null,
                      h('p', { style: STYLES.hintText }, t('execution.session.unknownHint')),
                      h('p', { style: STYLES.hintText }, t('execution.session.warningArchive')),
                      executionStrategy === 'fork'
                        ? h('p', { style: STYLES.hintText }, t('execution.session.warningFork'))
                        : null,
                    ),

                h(
                  'div',
                  { style: STYLES.summaryBox },
                  h('div', { style: { fontWeight: 600 } }, t('execution.summary.title')),
                  summaryRow(t('execution.summary.todo'), target.title),
                  summaryRow(
                    t('execution.summary.workspace'),
                    workspace === undefined
                      ? t('execution.summary.unset')
                      : `${workspace.title} — ${workspace.path}`,
                  ),
                  summaryRow(t('execution.summary.strategy'), strategyLabel(t, executionStrategy)),
                  summaryRow(
                    t('execution.summary.session'),
                    executionStrategy === 'new'
                      ? t('execution.summary.newSession')
                      : sourceSession === undefined
                        ? t('execution.summary.unset')
                        : sessionDisplayLabel(t, sourceSession),
                  ),
                ),

                renderDispatchStatus(),
                dispatchAvailable
                  ? null
                  : h('p', { style: STYLES.errorText }, t('execution.dispatch.previewOnly')),
                executionNotice === null
                  ? null
                  : h('div', { role: 'status', style: STYLES.previewNotice }, executionNotice),
                h(
                  'div',
                  { style: STYLES.formActions },
                  h(
                    'button',
                    {
                      type: 'button',
                      style: STYLES.secondaryButton,
                      onClick: closeExecution,
                    },
                    t('execution.back'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      style: {
                        ...STYLES.primaryButton,
                        ...(dispatchBusy || !dispatchAvailable || dispatchResult !== null
                          ? { opacity: 0.55, cursor: 'default' }
                          : {}),
                      },
                      onClick: () => void startDispatch(),
                      disabled: dispatchBusy || !dispatchAvailable || dispatchResult !== null,
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

          function renderRow(todo: Todo, index: number): unknown {
            const busy = busyId === todo.id
            const confirming = confirmId === todo.id

            const actions = confirming
              ? h(
                  'div',
                  {
                    style: STYLES.rowActions,
                    onKeyDown: (event: { key?: string }) => {
                      if (event.key === 'Escape') setConfirmId(null)
                    },
                  },
                  h('span', { style: STYLES.confirmText }, t('list.confirmDelete')),
                  h(
                    'button',
                    {
                      type: 'button',
                      style: {
                        ...STYLES.dangerButton,
                        ...(busy ? { opacity: 0.6 } : {}),
                      },
                      onClick: () => void removeTodo(todo.id),
                      disabled: busy,
                      'aria-busy': busy,
                    },
                    busy ? t('form.saving') : t('list.deleteConfirm'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      style: STYLES.secondaryButton,
                      onClick: () => setConfirmId(null),
                      disabled: busy,
                    },
                    t('list.deleteCancel'),
                  ),
                )
              : h(
                  'div',
                  { style: STYLES.rowActions },
                  iconButton(t('execution.action'), ICON_PLAY, () => openExecution(todo), {
                    disabled: busy,
                  }),
                  iconButton(
                    t('list.moveUp'),
                    ICON_UP,
                    () => void moveTodo(todo.id, 'up'),
                    { disabled: index === 0 || busy },
                  ),
                  iconButton(
                    t('list.moveDown'),
                    ICON_DOWN,
                    () => void moveTodo(todo.id, 'down'),
                    { disabled: index === todos.length - 1 || busy },
                  ),
                  iconButton(t('list.edit'), ICON_EDIT, () => openEdit(todo), { disabled: busy }),
                  iconButton(t('list.delete'), ICON_TRASH, () => setConfirmId(todo.id), {
                    disabled: busy,
                    danger: true,
                  }),
                )

            return h(
              'div',
              {
                key: todo.id,
                style: index === 0 ? { ...STYLES.row, borderTop: 'none' } : STYLES.row,
              },
              h(
                'div',
                { style: STYLES.rowMain },
                h('div', { style: STYLES.rowTitle }, todo.title),
                todo.description === ''
                  ? null
                  : h('div', { style: STYLES.rowDescription }, todo.description),
                h(
                  'div',
                  { style: STYLES.rowMeta },
                  t('list.createdAt').replace(
                    '{time}',
                    formatCreatedAt(todo.createdAt, dateLocale),
                  ),
                ),
              ),
              actions,
            )
          }

          function renderEmpty(): unknown {
            return h(
              'div',
              { style: STYLES.emptyCard },
              h(
                'div',
                { style: STYLES.emptyIcon },
                h(TaskInboxIcon, { size: 28, active: false }),
              ),
              h('h2', { style: STYLES.emptyTitle }, t('list.empty.title')),
              h('p', { style: STYLES.emptyText }, t('list.empty.description')),
              h(
                'button',
                {
                  type: 'button',
                  style: { ...STYLES.primaryButton, marginTop: '18px' },
                  onClick: openCreate,
                },
                t('list.empty.action'),
              ),
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
                h(
                  'p',
                  { role: 'alert', style: STYLES.errorText },
                  loadError === 'unknown' || loadError === ''
                    ? t('error.loadFailed')
                    : messageForCode(t, loadError),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    style: { ...STYLES.secondaryButton, marginTop: '12px' },
                    onClick: () => void load(),
                  },
                  t('list.retry'),
                ),
              )
            }
            if (todos.length === 0) return renderEmpty()
            return h(
              'div',
              null,
              h(
                'p',
                { style: STYLES.count },
                t('list.count').replace('{n}', String(todos.length)),
              ),
              h('div', { style: STYLES.list }, ...todos.map((todo, index) => renderRow(todo, index))),
            )
          }

          const addButtonDisabled = editorMode !== null || saving || executionTarget !== null
          return h(
            'section',
            { style: STYLES.page, 'data-dsh-plugin': PACKAGE_ID },
            h(
              'div',
              { style: STYLES.frame },
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
                    style: {
                      ...STYLES.primaryButton,
                      ...(addButtonDisabled ? { opacity: 0.55, cursor: 'default' } : {}),
                    },
                    onClick: openCreate,
                    disabled: addButtonDisabled,
                  },
                  svgIcon(14, ICON_PLUS),
                  h('span', null, t('add.button')),
                ),
              ),
              renderBanner(),
              executionTarget === null ? renderEditor() : null,
              executionTarget === null ? renderList() : renderExecutionPanel(),
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
