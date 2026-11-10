/**
 * Storage-domain declaration for task-inbox records.
 *
 * Atomicity model (Task 02 review fix):
 * - DSH Storage Domain exposes no multi-record transaction: `KvTable.put` /
 *   `delete` / `deleteMany` each commit one backend write, so writing several
 *   records (and thus a reorder) can partially commit.
 * - `Domain.global.set(value)` commits the whole unit-global value in ONE
 *   backend write. Version 2 therefore stores the complete ordered todo list in
 *   the global value, making every mutation (create/update/delete/move) a
 *   single all-or-nothing write.
 * - Version 1 stored per-record rows in the `todos` table. The v1 table stays
 *   declared so `compatibleVersions: [1]` can open existing data; the Host
 *   migrates rows into the global value once (`migrated` marker) and then
 *   best-effort deletes the legacy rows.
 *
 * Domain and table names follow the storage unit-name rule (`^[a-z][a-z0-9_]*$`).
 * `layout: 'single'` keeps one pretty JSON document per unit, which makes the
 * data easy to inspect and back up.
 */
import { z } from 'zod';
import { DESCRIPTION_MAX_LENGTH, TODO_STATUS_TODO, TITLE_MAX_LENGTH, } from './model.js';
/** Record schema used by both the v2 global state and the legacy v1 table. */
const todoRecordSchema = z.object({
    id: z.string().min(1).max(128),
    title: z.string().min(1).max(TITLE_MAX_LENGTH),
    description: z.string().max(DESCRIPTION_MAX_LENGTH),
    status: z.literal(TODO_STATUS_TODO),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    order: z.number().int().min(0),
});
export const TODO_DOMAIN_SPEC = {
    name: 'task_inbox',
    version: 2,
    compatibleVersions: [1],
    layout: 'single',
    global: {
        schema: z.object({
            todos: z.array(todoRecordSchema),
            migrated: z.boolean(),
        }),
        initial: { todos: [], migrated: false },
    },
    /**
     * Legacy v1 rows. Kept declared so old units open and validate; the Host
     * migrates and then removes them. A later task may drop this table with a
     * version 3 migration once all installations have migrated.
     */
    tables: {
        todos: {
            valueSchema: todoRecordSchema,
        },
    },
};
