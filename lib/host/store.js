export class DomainTodoRepository {
    domain;
    constructor(domain) {
        this.domain = domain;
    }
    table() {
        return this.domain.table('todos');
    }
    all() {
        const todos = [];
        for (const [, todo] of this.table().entries())
            todos.push(todo);
        return todos;
    }
    get(id) {
        return this.table().get(id);
    }
    put(todo) {
        return this.table().put(todo.id, todo);
    }
    delete(id) {
        return this.table().delete(id);
    }
}
