import type { Actor } from '../../domain/sessions/session-event.entity';
import type { ActionStatus } from '../../domain/actions/action-state-machine';
import type { PermissionPolicy } from '../../domain/actions/permissions-file';
import type { ProposedAction } from '../../domain/actions/proposed-action.entity';
import type { TerminalExecutionResult } from '../../domain/actions/terminal-execution-result';
import type { GitBootstrapExecutionResult } from '../../domain/git/bootstrap-execution-result';
import type { AdrPrExecutionResult } from '../../domain/git/adr-pr-execution-result';
import type { GitActionExecutionResult } from '../../domain/git/git-action-execution-result';
import type { InfraPrExecutionResult } from '../../domain/git/infra-pr-execution-result';

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

export interface ExecutionResultUpdate {
  status: Extract<ActionStatus, 'executed' | 'failed'>;
  executionResult:
    | TerminalExecutionResult
    | GitBootstrapExecutionResult
    | AdrPrExecutionResult
    | GitActionExecutionResult
    | InfraPrExecutionResult;
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
  abstract updateExecutionResult(
    actionId: string,
    input: ExecutionResultUpdate,
  ): Promise<ProposedAction>;
  // Ações de um tipo num projeto (Fase 3b) — pra a seção de arquitetura listar
  // as ADRs (open_adr_pr) com o link da PR.
  abstract listByProjectAndType(
    projectId: string,
    actionType: string,
  ): Promise<ProposedAction[]>;
  abstract listPaginated(
    sessionId: string,
    opts: ListProposedActionsOptions,
  ): Promise<Page<ProposedAction>>;
}
