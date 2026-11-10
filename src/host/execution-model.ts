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
  status: ExecutionStatus
  errorCode?: string
  createdAt: string
  updatedAt: string
  /** Creation time in epoch ms, used for fork-candidate reconciliation. */
  createdAtMs: number
}

export const EXECUTION_STATUSES: readonly ExecutionStatus[] = [
  'prepared',
  'session_ready',
  'dispatching',
  'accepted',
  'failed',
  'unknown',
]

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
  status: z.enum(['prepared', 'session_ready', 'dispatching', 'accepted', 'failed', 'unknown']),
  errorCode: z.string().max(128).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  createdAtMs: z.number().int().min(0),
})
