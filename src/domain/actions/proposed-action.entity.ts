import type { Actor } from '../sessions/session-event.entity';
import type { ActionStatus } from './action-state-machine';
import type { PermissionPolicy } from './permission-resolver';

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
  createdAt: Date;
  updatedAt: Date;
}
