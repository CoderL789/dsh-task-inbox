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

interface ClientContext {
  slots: SlotService
  locale: LocaleService
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

          const addButtonDisabled = editorMode !== null || saving
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
              renderEditor(),
              renderList(),
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
