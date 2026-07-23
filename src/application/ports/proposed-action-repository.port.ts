import type { Actor } from '../../domain/sessions/session-event.entity';
import type { ActionStatus } from '../../domain/actions/action-state-machine';
import type { PermissionPolicy } from '../../domain/actions/permission-resolver';
import type { ProposedAction } from '../../domain/actions/proposed-action.entity';

export interface NewProposedAction {
  projectId: string;
  sessionId: string;
  actionType: string;
  payload: unknown;
  status: ActionStatus;
  resolvedPolicy: PermissionPolicy;
  actor: Actor;
  rejectionReason?: string | null;
}

export interface DecideProposedAction {
  status: ActionStatus;
  decidedBy: string;
  decidedAt: Date;
  rejectionReason?: string | null;
}

export interface ListProposedActionsOptions {
  afterSeq?: number;
  limit?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: number | null;
}

export abstract class ProposedActionRepository {
  abstract create(input: NewProposedAction): Promise<ProposedAction>;
  abstract findInSessionForUpdate(
    sessionId: string,
    actionId: string,
  ): Promise<ProposedAction | null>;
  abstract updateDecision(
    actionId: string,
    input: DecideProposedAction,
  ): Promise<ProposedAction>;
  abstract listPaginated(
    sessionId: string,
    opts: ListProposedActionsOptions,
  ): Promise<Page<ProposedAction>>;
}
