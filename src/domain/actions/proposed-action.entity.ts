import type { Actor } from '../sessions/session-event.entity';
import type { ActionStatus } from './action-state-machine';
import type { PermissionPolicy } from './permissions-file';
import type { TerminalExecutionResult } from './terminal-execution-result';

export interface ProposedAction {
  id: string;
  projectId: string;
  sessionId: string;
  seq: number;
  actionType: string;
  payload: unknown;
  status: ActionStatus;
  resolvedPolicy: PermissionPolicy;
  actor: Actor;
  decidedBy: string | null;
  decidedAt: Date | null;
  rejectionReason: string | null;
  executionResult: TerminalExecutionResult | null;
  createdAt: Date;
  updatedAt: Date;
}
