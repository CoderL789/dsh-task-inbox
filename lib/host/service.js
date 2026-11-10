/**
 * Todo CRUD service: validation, timestamps, ordering, idempotent creates,
 * and atomic serialized mutations.
 *
 * Concurrency model (Task 02 review fix):
 * - Every mutation runs through one in-process promise queue, so read-modify-
 *   write sequences never interleave: two concurrent creates cannot pick the
 *   same order value, and a move cannot race an update/delete.
 * - Each mutation persists by replacing the complete ordered list with ONE
 *   `repository.write()` call (a single atomic global write). A failed write
 *   leaves the previous state untouched — no partial reorder is possible.
 * - Create idempotency (`requestId`) is checked inside the queue, after the
 *   previous create committed, so concurrent duplicates return the same todo.
 *
 * The service depends only on the state repository interface and a clock/id
 * generator, never on DSH services, so its behavior is unit-testable.
 */
import { normalizeOrder, normalizeTodoInput, planMove, sortTodos, TODO_STATUS_TODO, } from './model.js';
export class TodoServiceError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'TodoServiceError';
        this.code = code;
    }
}
/** How long a create request id is remembered for double-submit protection. */
export const REQUEST_DEDUPE_MS = 10 * 60 * 1000;
const RECENT_CREATES_LIMIT = 200;
export class TodoService {
    options;
    recentCreates = new Map();
    /** Tail of the mutation queue; every link settles so one failure cannot stall later work. */
    mutationTail = Promise.resolve();
    constructor(options) {
        this.options = options;
    }
    list() {
        return sortTodos(this.options.repository.read());
    }
    create(input) {
        return this.exclusive(async () => {
            const normalized = normalizeTodoInput(input);
            if (!normalized.ok) {
                throw new TodoServiceError(normalized.code, normalized.message);
            }
            const current = sortTodos(this.options.repository.read());
            const requestId = typeof input.requestId === 'string' ? input.requestId : '';
            if (requestId !== '') {
                const cached = this.recentCreates.get(requestId);
                if (cached !== undefined) {
                    const stillExists = current.some((todo) => todo.id === cached.todo.id);
                    if (stillExists && this.options.clock.epochMs() - cached.at <= REQUEST_DEDUPE_MS) {
                        return cached.todo;
                    }
                    this.recentCreates.delete(requestId);
                }
            }
            const now = this.options.clock.isoNow();
            const todo = {
                id: this.options.ids.next(),
                title: normalized.value.title,
                description: normalized.value.description,
                status: TODO_STATUS_TODO,
                createdAt: now,
                updatedAt: now,
                order: current.length,
            };
            const next = normalizeOrder([...current, todo]);
            await this.durable(() => this.options.repository.write(next));
            if (requestId !== '')
                this.rememberCreate(requestId, todo);
            return todo;
        });
    }
    update(input) {
        return this.exclusive(async () => {
            const id = typeof input.id === 'string' ? input.id : '';
            const current = sortTodos(this.options.repository.read());
            const index = current.findIndex((todo) => todo.id === id);
            if (index === -1) {
                throw new TodoServiceError('not_found', 'Task was not found.');
            }
            const normalized = normalizeTodoInput(input);
            if (!normalized.ok) {
                throw new TodoServiceError(normalized.code, normalized.message);
            }
            const todo = {
                ...current[index],
                title: normalized.value.title,
                description: normalized.value.description,
                updatedAt: this.options.clock.isoNow(),
            };
            const next = normalizeOrder(current.slice(0, index).concat(todo, current.slice(index + 1)));
            await this.durable(() => this.options.repository.write(next));
            return todo;
        });
    }
    delete(id) {
        return this.exclusive(async () => {
            const todoId = typeof id === 'string' ? id : '';
            if (todoId === '')
                return false;
            const current = sortTodos(this.options.repository.read());
            const next = current.filter((todo) => todo.id !== todoId);
            if (next.length === current.length)
                return false;
            await this.durable(() => this.options.repository.write(normalizeOrder(next)));
            return true;
        });
    }
    move(id, direction) {
        return this.exclusive(async () => {
            const todoId = typeof id === 'string' ? id : '';
            const plan = planMove(this.options.repository.read(), todoId, direction, this.options.clock.isoNow());
            if (plan === null) {
                throw new TodoServiceError('not_found', 'Task was not found.');
            }
            const next = normalizeOrder(plan.todos);
            if (plan.changed.length > 0) {
                await this.durable(() => this.options.repository.write(next));
            }
            return next;
        });
    }
    /**
     * Run one mutation at the tail of the queue. The queue never rejects, so a
     * failed mutation does not block later operations.
     */
    exclusive(operation) {
        const result = this.mutationTail.then(operation, operation);
        this.mutationTail = result.then(() => undefined, () => undefined);
        return result;
    }
    async durable(operation) {
        try {
            return await operation();
        }
        catch (error) {
            // The domain rejects a write before mutating its in-memory state, so a
            // failed persist leaves reads consistent with the medium.
            if (error instanceof TodoServiceError)
                throw error;
            throw new TodoServiceError('storage_failed', 'The change could not be saved to storage.');
        }
    }
    rememberCreate(requestId, todo) {
        this.recentCreates.set(requestId, { todo, at: this.options.clock.epochMs() });
        while (this.recentCreates.size > RECENT_CREATES_LIMIT) {
            const oldest = this.recentCreates.keys().next();
            if (oldest.done === true)
                break;
            this.recentCreates.delete(oldest.value);
        }
    }
}
