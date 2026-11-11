/**
 * Execution records for Task 03B dispatch coordination.
 *
 * The plugin keeps Todo data in its existing `task_inbox` domain untouched and
 * stores execution records in a separate, new domain. This avoids any upgrade
 * or rewrite of the Todo storage (so old Todos can never be reset by Task 03B)
 * while giving dispatch records their own schema/version line.
 */
import { z } from 'zod';
export const EXECUTION_EVENT_KINDS = [
    'intent_created',
    'dispatch_started',
    'prompt_dispatch_started',
    'prompt_retry_started',
    'session_ready',
    'session_bound',
    'prompt_accepted',
    'prompt_failed',
    'outcome_unknown',
    'recovered',
    'abandoned',
    'status_changed',
];
export const EXECUTION_STATUSES = [
    'prepared',
    'session_ready',
    'dispatching',
    'accepted',
    'failed',
    'unknown',
];
export const EXECUTION_EVENT_SCHEMA = z.object({
    eventId: z.string().min(1).max(160),
    kind: z.enum(EXECUTION_EVENT_KINDS),
    at: z.string().min(1),
    fromStatus: z.enum(['prepared', 'session_ready', 'dispatching', 'accepted', 'failed', 'unknown']).optional(),
    toStatus: z.enum(['prepared', 'session_ready', 'dispatching', 'accepted', 'failed', 'unknown']).optional(),
    sessionId: z.string().min(1).max(128).optional(),
    bindingSource: z.enum(['client', 'manual']).optional(),
    errorCode: z.string().max(128).optional(),
});
export const EXECUTION_RECORD_SCHEMA = z.object({
    executionId: z.string().min(1).max(128),
    clientRequestId: z.string().min(1).max(128),
    requestId: z.string().min(1).max(128),
    todoId: z.string().min(1).max(128),
    todoTitle: z.string().max(200),
    promptText: z.string().min(1).max(2400),
    strategy: z.enum(['new', 'reuse', 'fork']),
    workspaceId: z.string().min(1).max(128),
    workspacePath: z.string().min(1),
    sourceSessionId: z.string().min(1).max(128).optional(),
    targetSessionId: z.string().min(1).max(128).optional(),
    bindingSource: z.enum(['client', 'manual']).optional(),
    dispatchLeaseToken: z.string().min(1).max(128).optional(),
    dispatchLeaseAcquiredAt: z.string().min(1).optional(),
    dispatchLeaseExpiresAt: z.string().min(1).optional(),
    status: z.enum(['prepared', 'session_ready', 'dispatching', 'accepted', 'failed', 'unknown']),
    errorCode: z.string().max(128).optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    createdAtMs: z.number().int().min(0),
    events: z.array(EXECUTION_EVENT_SCHEMA).optional(),
});
