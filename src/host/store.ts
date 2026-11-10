/**
 * Repository over the plugin-owned storage domain.
 *
 * Only the two methods needed by the CRUD service are exposed, so the service
 * can be unit tested against an in-memory fake instead of the DSH runtime.
 */
import type { Todo } from './model.js'

/** The subset of the DSH `KvTable` used here. */
export interface TodoTableLike {
  get(key: string): Todo | undefined
  entries(): IterableIterator<[string, Todo]>
  readonly size: number
  put(key: string, value: Todo): Promise<void>
  delete(key: string): Promise<boolean>
}

/** The subset of an opened DSH `Domain` used here. */
export interface TodoDomainLike {
  table(name: 'todos'): TodoTableLike
  close(): Promise<void>
}

export interface TodoRepository {
  all(): Todo[]
  get(id: string): Todo | undefined
  put(todo: Todo): Promise<void>
  delete(id: string): Promise<boolean>
}

export class DomainTodoRepository implements TodoRepository {
  private readonly domain: TodoDomainLike

  constructor(domain: TodoDomainLike) {
    this.domain = domain
  }

  private table(): TodoTableLike {
    return this.domain.table('todos')
  }

  all(): Todo[] {
    const todos: Todo[] = []
    for (const [, todo] of this.table().entries()) todos.push(todo)
    return todos
  }

  get(id: string): Todo | undefined {
    return this.table().get(id)
  }

  put(todo: Todo): Promise<void> {
    return this.table().put(todo.id, todo)
  }

  delete(id: string): Promise<boolean> {
    return this.table().delete(id)
  }
}
