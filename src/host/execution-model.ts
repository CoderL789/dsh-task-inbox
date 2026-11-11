/**
 * Execution records for Task 03B dispatch coordination.
 *
 * The plugin keeps Todo data in its existing `task_inbox` domain untouched and
 * stores execution records in a separate, new domain. This avoids any upgrade
 * or rewrite of the Todo storage (so old Todos can never be reset by Task 03B)
 * while giving dispatch records their own schema/version line.
 */
import { z } from 'zod'

export type ExecutionStrategy = 'new' | 'reuse' | 'fork'

/**
 * Safe-dispatch lifecycle (Task 03B only; the full Task 04 state machine will
 * build on it):
 * - prepared: intent persisted, no session operation confirmed yet;
 * - session_ready: target Session id persisted, prompt not confirmed accepted;
 * - dispatching: prompt admission in flight, or Host verification pending;
 * - accepted: DSH acceptance independently verified by the Host;
 * - failed: definite failure;
 * - unknown: outcome cannot be determined; manual reconciliation required.
 */
export type ExecutionStatus =
  | 'prepared'
  | 'session_ready'
  | 'dispatching'
  | 'accepted'
  | 'failed'
  | 'unknown'

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
] as const

export type ExecutionEventKind = typeof EXECUTION_EVENT_KINDS[number]

/** A durable, evidence-backed event in one execution's dispatch lifecycle. */
export interface ExecutionEvent {
  eventId: string
  kind: ExecutionEventKind
  at: string
  fromStatus?: ExecutionStatus
  toStatus?: ExecutionStatus
  sessionId?: string
  bindingSource?: 'client' | 'manual'
  errorCode?: string
}

/** Minimal cross-Todo read model for the workbench overview. */
export interface ExecutionOverviewRecord {
  executionId: string
  todoId: string
  strategy: ExecutionStrategy
  workspaceId: string
  workspacePath: string
  sourceSessionId?: string
  targetSessionId?: string
  bindingSource?: 'client' | 'manual'
  status: ExecutionStatus
  errorCode?: string
  createdAt: string
  updatedAt: string
  createdAtMs: number
}

export interface ExecutionRecord {
  executionId: string
  clientRequestId: string
  requestId: string
  todoId: string
  todoTitle: string
  /** Immutable prompt snapshot taken when the intent was created. */
  promptText: string
  strategy: ExecutionStrategy
  workspaceId: string
  workspacePath: string
  sourceSessionId?: string
  targetSessionId?: string
  /** How the target Session was associated: Client-reported or manual candidate. */
  bindingSource?: 'client' | 'manual'
  /** Exclusive right to perform the non-idempotent create/fork. */
  dispatchLeaseToken?: string
  dispatchLeaseAcquiredAt?: string
  dispatchLeaseExpiresAt?: string
  status: ExecutionStatus
  errorCode?: string
  createdAt: string
  updatedAt: string
  /** Creation time in epoch ms, used for fork-candidate reconciliation. */
  createdAtMs: number
  /** Optional append-only dispatch timeline; absent on pre-03C records. */
  events?: ExecutionEvent[]
}

export const EXECUTION_STATUSES: readonly ExecutionStatus[] = [
  'prepared',
  'session_ready',
  'dispatching',
  'accepted',
  'failed',
  'unknown',
]

export const EXECUTION_EVENT_SCHEMA = z.object({
  eventId: z.string().min(1).max(160),
  kind: z.enum(EXECUTION_EVENT_KINDS),
  at: z.string().min(1),
  fromStatus: z.enum(['prepared', 'session_ready', 'dispatching', 'accepted', 'failed', 'unknown']).optional(),
  toStatus: z.enum(['prepared', 'session_ready', 'dispatching', 'accepted', 'failed', 'unknown']).optional(),
  sessionId: z.string().min(1).max(128).optional(),
  bindingSource: z.enum(['client', 'manual']).optional(),
  errorCode: z.string().max(128).optional(),
})

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
})
