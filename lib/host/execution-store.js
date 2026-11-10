/**
 * Storage and serialization for execution records.
 *
 * New separate domain `task_inbox_executions` (version 1, single global
 * document): the existing Todo domain `task_inbox` remains untouched at v2.
 * Each mutation replaces the complete execution list in one atomic write; the
 * same durable-outcome handling as the Todo store closes and reopens the
 * domain when a write result is ambiguous.
 */
import { z } from 'zod';
import { classifyStorageWriteError, TodoStorageDefiniteError, TodoStorageUncertainError, } from './store.js';
import { EXECUTION_RECORD_SCHEMA, } from './execution-model.js';
export const EXECUTION_DOMAIN_SPEC = {
    name: 'task_inbox_executions',
    version: 1,
    layout: 'single',
    global: {
        schema: z.object({
            executions: z.array(EXECUTION_RECORD_SCHEMA),
        }),
        initial: { executions: [] },
    },
    tables: {},
};
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
function serialize(records) {
    return JSON.stringify(records);
}
export class DomainExecutionRepository {
    domain;
    reopen;
    uncertain = null;
    closed = false;
    constructor(domain, reopen) {
        this.domain = domain;
        this.reopen = reopen;
    }
    read() {
        this.assertUsable();
        try {
            const state = this.domain.global.get();
            return Array.isArray(state.executions) ? [...state.executions] : [];
        }
        catch (error) {
            throw this.readFailure(error);
        }
    }
    async write(records) {
        this.assertUsable();
        const next = [...records];
        const previous = this.read();
        try {
            await this.domain.global.set({ executions: next });
            return;
        }
        catch (error) {
            if (classifyStorageWriteError(error) === 'definite') {
                throw new TodoStorageDefiniteError(`Execution record was not saved: ${describeError(error)}`);
            }
            if (this.reopen === undefined)
                throw this.poison(error);
            let reopened;
            try {
                await this.domain.close();
                reopened = await this.reopen();
            }
            catch (recoveryError) {
                throw this.poison(error, recoveryError);
            }
            this.domain = reopened;
            let durable;
            try {
                const state = reopened.global.get();
                durable = Array.isArray(state.executions) ? [...state.executions] : [];
            }
            catch (readError) {
                throw this.poison(error, readError);
            }
            if (serialize(durable) === serialize(next))
                return;
            if (serialize(durable) === serialize(previous)) {
                throw new TodoStorageDefiniteError('Execution record was not saved to storage.');
            }
            throw this.poison(error);
        }
    }
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        await this.domain.close();
    }
    assertUsable() {
        if (this.uncertain !== null)
            throw this.uncertain;
        if (this.closed)
            throw new TodoStorageDefiniteError('Execution storage is closed.');
    }
    readFailure(error) {
        if (error instanceof TodoStorageUncertainError)
            return error;
        if (this.uncertain !== null)
            return this.uncertain;
        return new TodoStorageDefiniteError(`Execution storage could not be read: ${describeError(error)}`);
    }
    poison(original, recoveryError) {
        const note = recoveryError === undefined ? '' : `; reopen failed: ${describeError(recoveryError)}`;
        const error = new TodoStorageUncertainError(`Execution storage result is unknown (${describeError(original)}${note}). ` +
            'Reload or restart DSH before retrying.');
        this.uncertain = error;
        return error;
    }
}
/** Serialized whole-list store shared by all execution mutations. */
export class ExecutionStore {
    repository;
    tail = Promise.resolve();
    constructor(repository) {
        this.repository = repository;
    }
    read() {
        return this.repository.read();
    }
    /** Serialize read-modify-write so concurrent intents/results cannot interleave. */
    mutate(recipe) {
        const run = async () => {
            const current = this.repository.read();
            const { next, result } = recipe(current);
            await this.repository.write(next);
            return result;
        };
        const pending = this.tail.then(run, run);
        this.tail = pending.then(() => undefined, () => undefined);
        return pending;
    }
}
