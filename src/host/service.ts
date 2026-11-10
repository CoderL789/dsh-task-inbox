/**
 * Todo CRUD service: validation, timestamps, ordering, idempotent creates.
 *
 * The service depends only on a repository interface and a clock/id generator,
 * never on DSH services, so its behavior is unit-testable with fakes.
 */
import {
  normalizeTodoInput,
  nextOrder,
  planMove,
  sortTodos,
  TODO_STATUS_TODO,
  type MoveDirection,
  type Todo,
} from './model.js'

export interface Clock {
  isoNow(): string
  epochMs(): number
}

export interface IdGenerator {
  next(): string
}

export interface TodoRepositoryLike {
  all(): Todo[]
  get(id: string): Todo | undefined
  put(todo: Todo): Promise<void>
  delete(id: string): Promise<boolean>
}

export interface TodoServiceOptions {
  repository: TodoRepositoryLike
  clock: Clock
  ids: IdGenerator
}

export type TodoServiceErrorCode =
  | 'invalid_title'
  | 'invalid_description'
  | 'not_found'
  | 'storage_failed'

export class TodoServiceError extends Error {
  readonly code: TodoServiceErrorCode

  constructor(code: TodoServiceErrorCode, message: string) {
    super(message)
    this.name = 'TodoServiceError'
    this.code = code
  }
}

export interface CreateTodoInput {
  title?: unknown
  description?: unknown
  requestId?: unknown
}

export interface UpdateTodoInput {
  id?: unknown
  title?: unknown
  description?: unknown
  requestId?: unknown
}

/** How long a create request id is remembered for double-submit protection. */
export const REQUEST_DEDUPE_MS = 10 * 60 * 1000
const RECENT_CREATES_LIMIT = 200

export class TodoService {
  private readonly options: TodoServiceOptions
  private readonly recentCreates = new Map<string, { todo: Todo; at: number }>()

  constructor(options: TodoServiceOptions) {
    this.options = options
  }

  list(): Todo[] {
    return sortTodos(this.options.repository.all())
  }

  async create(input: CreateTodoInput): Promise<Todo> {
    const normalized = normalizeTodoInput(input)
    if (!normalized.ok) {
      throw new TodoServiceError(normalized.code, normalized.message)
    }

    const requestId = typeof input.requestId === 'string' ? input.requestId : ''
    if (requestId !== '') {
      const cached = this.recentCreates.get(requestId)
      if (cached !== undefined) {
        if (this.options.clock.epochMs() - cached.at <= REQUEST_DEDUPE_MS) return cached.todo
        this.recentCreates.delete(requestId)
      }
    }

    const now = this.options.clock.isoNow()
    const order = nextOrder(this.options.repository.all())
    const todo: Todo = {
      id: this.options.ids.next(),
      title: normalized.value.title,
      description: normalized.value.description,
      status: TODO_STATUS_TODO,
      createdAt: now,
      updatedAt: now,
      order,
    }

    await this.durable(() => this.options.repository.put(todo))
    if (requestId !== '') this.rememberCreate(requestId, todo)
    return todo
  }

  async update(input: UpdateTodoInput): Promise<Todo> {
    const id = typeof input.id === 'string' ? input.id : ''
    const existing = this.options.repository.get(id)
    if (existing === undefined) {
      throw new TodoServiceError('not_found', 'Task was not found.')
    }

    const normalized = normalizeTodoInput(input)
    if (!normalized.ok) {
      throw new TodoServiceError(normalized.code, normalized.message)
    }

    const todo: Todo = {
      ...existing,
      title: normalized.value.title,
      description: normalized.value.description,
      updatedAt: this.options.clock.isoNow(),
    }
    await this.durable(() => this.options.repository.put(todo))
    return todo
  }

  async delete(id: unknown): Promise<boolean> {
    const todoId = typeof id === 'string' ? id : ''
    if (todoId === '') return false
    return this.durable(() => this.options.repository.delete(todoId))
  }

  async move(id: unknown, direction: MoveDirection): Promise<Todo[]> {
    const todoId = typeof id === 'string' ? id : ''
    const plan = planMove(
      this.options.repository.all(),
      todoId,
      direction,
      this.options.clock.isoNow(),
    )
    if (plan === null) {
      throw new TodoServiceError('not_found', 'Task was not found.')
    }

    for (const todo of plan.changed) {
      await this.durable(() => this.options.repository.put(todo))
    }
    return plan.todos
  }

  private async durable<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      // The domain rejects a write before mutating its in-memory state, so a
      // failed persist leaves reads consistent with the medium.
      if (error instanceof TodoServiceError) throw error
      throw new TodoServiceError('storage_failed', 'The change could not be saved to storage.')
    }
  }

  private rememberCreate(requestId: string, todo: Todo): void {
    this.recentCreates.set(requestId, { todo, at: this.options.clock.epochMs() })
    while (this.recentCreates.size > RECENT_CREATES_LIMIT) {
      const oldest = this.recentCreates.keys().next()
      if (oldest.done === true) break
      this.recentCreates.delete(oldest.value)
    }
  }
}
