/**
 * Storage-domain declaration for task-inbox records.
 *
 * The domain is opened through the public `ctx.storageDomain` service; records
 * are validated by the zod schema both when written and when the domain is
 * opened, so corrupted records cannot silently reach the API.
 *
 * Domain and table names follow the storage unit-name rule (`^[a-z][a-z0-9_]*$`).
 * `layout: 'single'` keeps one pretty JSON document per unit, which makes the
 * data easy to inspect and back up.
 */
import { z } from 'zod';
import { DESCRIPTION_MAX_LENGTH, TODO_STATUS_TODO, TITLE_MAX_LENGTH, } from './model.js';
export const TODO_DOMAIN_SPEC = {
    name: 'task_inbox',
    version: 1,
    layout: 'single',
    tables: {
        todos: {
            valueSchema: z.object({
                id: z.string().min(1).max(128),
                title: z.string().min(1).max(TITLE_MAX_LENGTH),
                description: z.string().max(DESCRIPTION_MAX_LENGTH),
                status: z.literal(TODO_STATUS_TODO),
                createdAt: z.string().min(1),
                updatedAt: z.string().min(1),
                order: z.number().int().min(0),
            }),
        },
    },
};
