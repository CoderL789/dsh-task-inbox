/**
 * Pure task-inbox model: record shape, input normalization, and ordering.
 *
 * This module intentionally has no imports and no I/O so the Host CRUD rules,
 * validation, and reordering can be unit tested without the DSH runtime.
 */

export type TodoStatus = 'todo'

/** One stored todo record. Records live in the plugin's own storage domain. */
export interface Todo {
  id: string
  title: string
  description: string
  status: TodoStatus
  createdAt: string
  updatedAt: string
  order: number
}

export const TODO_STATUS_TODO: TodoStatus = 'todo'
export const TITLE_MAX_LENGTH = 200
export const DESCRIPTION_MAX_LENGTH = 2000
export const ID_MAX_LENGTH = 128

export type MoveDirection = 'up' | 'down'

export type ValidationErrorCode = 'invalid_title' | 'invalid_description'

export interface NormalizedTodoInput {
  title: string
  description: string
}

export type ValidationResult =
  | { ok: true; value: NormalizedTodoInput }
  | { ok: false; code: ValidationErrorCode; message: string }

/** Normalize a create/update payload: trim title, default description to ''. */
export function normalizeTodoInput(input: {
  title?: unknown
  description?: unknown
}): ValidationResult {
  const rawTitle = input.title
  if (typeof rawTitle !== 'string') {
    return { ok: false, code: 'invalid_title', message: 'Title must be a string.' }
  }
  const title = rawTitle.trim()
  if (title.length === 0) {
    return { ok: false, code: 'invalid_title', message: 'Title is required.' }
  }
  if (title.length > TITLE_MAX_LENGTH) {
    return {
      ok: false,
      code: 'invalid_title',
      message: `Title must be at most ${TITLE_MAX_LENGTH} characters.`,
    }
  }

  const rawDescription = input.description
  if (rawDescription !== undefined && rawDescription !== null && typeof rawDescription !== 'string') {
    return { ok: false, code: 'invalid_description', message: 'Description must be a string.' }
  }
  const description = typeof rawDescription === 'string' ? rawDescription.trim() : ''
  if (description.length > DESCRIPTION_MAX_LENGTH) {
    return {
      ok: false,
      code: 'invalid_description',
      message: `Description must be at most ${DESCRIPTION_MAX_LENGTH} characters.`,
    }
  }

  return { ok: true, value: { title, description } }
}

/** Stable display order: explicit order, then creation time, then id. */
export function compareTodos(left: Todo, right: Todo): number {
  if (left.order !== right.order) return left.order - right.order
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1
  if (left.id === right.id) return 0
  return left.id < right.id ? -1 : 1
}

export function sortTodos(todos: readonly Todo[]): Todo[] {
  return [...todos].sort(compareTodos)
}

/** Order value for a newly created todo (append to the end). */
export function nextOrder(todos: readonly Todo[]): number {
  let max = -1
  for (const todo of todos) {
    if (Number.isFinite(todo.order) && todo.order > max) max = todo.order
  }
  return max + 1
}

export interface ReorderPlan {
  /** The complete list in final display order. */
  todos: Todo[]
  /** Records whose `order` (and `updatedAt`) changed and must be persisted. */
  changed: Todo[]
}

/**
 * Plan a one-step move. Adjacent items swap places and every position is
 * renumbered, so equal/corrupted order values converge back to unique values.
 * Returns null when the id is absent; a no-op move returns the sorted list.
 */
export function planMove(
  todos: readonly Todo[],
  id: string,
  direction: MoveDirection,
  updatedAt: string,
): ReorderPlan | null {
  const sorted = sortTodos(todos)
  const index = sorted.findIndex((todo) => todo.id === id)
  if (index === -1) return null

  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= sorted.length) {
    return { todos: sorted, changed: [] }
  }

  const swapped = sorted.slice()
  const moved = swapped[index]
  swapped[index] = swapped[target]
  swapped[target] = moved

  const changed: Todo[] = []
  const renumbered = swapped.map((todo, position) => {
    if (todo.order === position) return todo
    const next = { ...todo, order: position, updatedAt }
    changed.push(next)
    return next
  })

  return { todos: renumbered, changed }
}
