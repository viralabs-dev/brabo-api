import type { Actor } from '../../domain/sessions/session-event.entity';
import type { ActionStatus } from '../../domain/actions/action-state-machine';
import type { PermissionPolicy } from '../../domain/actions/permissions-file';
import type { ProposedAction } from '../../domain/actions/proposed-action.entity';
import type { TerminalExecutionResult } from '../../domain/actions/terminal-execution-result';
import type { GitBootstrapExecutionResult } from '../../domain/git/bootstrap-execution-result';
import type { AdrPrExecutionResult } from '../../domain/git/adr-pr-execution-result';
import type { GitActionExecutionResult } from '../../domain/git/git-action-execution-result';
import type { InfraPrExecutionResult } from '../../domain/git/infra-pr-execution-result';
import type { InstructionPatchExecutionResult } from '../../domain/instructions/instruction-patch-execution-result';
import type { ContainerStartExecutionResult } from '../../domain/containers/container-start-execution-result';

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
    | InfraPrExecutionResult
    | InstructionPatchExecutionResult
    | ContainerStartExecutionResult;
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
  /**
   * Ações DECIDIDAS pelo usuário numa janela de tempo (Fase 4b — Anamnese).
   *
   * "comandos que aprova/nega" é um dos quatro sinais que o enunciado pede
   * pra derivar proficiência, e ele não está no event log: decisão vive
   * aqui, em `proposed_actions.decided_at`. O critério é ter DECISOR humano —
   * uma recusa de política não diz nada sobre a pessoa, e uma aprovação que já
   * executou (status `executed`) continua sendo uma decisão dela.
   */
  abstract listDecidedInWindow(
    projectId: string,
    from: Date,
    to: Date,
  ): Promise<ProposedAction[]>;
  abstract listPaginated(
    sessionId: string,
    opts: ListProposedActionsOptions,
  ): Promise<Page<ProposedAction>>;

  /**
   * A ação `pending` mais antiga da sessão, se houver (achado V).
   *
   * Existe para o heartbeat saber que há alguém ESPERANDO uma decisão antes de
   * encerrar a sessão por inatividade da aba. Devolve a ação em vez de um
   * booleano porque o motivo que o engine loga precisa dizer O QUE ficou
   * pendurado — "há trabalho pendente" não ajuda ninguém a diagnosticar.
   */
  abstract findOldestPendingInSession(
    sessionId: string,
  ): Promise<ProposedAction | null>;

  /**
   * Ações PENDENTES do PROJETO inteiro, em QUALQUER sessão (Onda 2 do
   * programa de abas agrupadas).
   *
   * Ao lado de `listPaginated`/`findOldestPendingInSession` (escopados por
   * SESSÃO) — é este método que fecha o bug de raiz da aba Aprovações
   * (`ProjectApprovalsTab.tsx`): ela só olha `usePendingActions(projectId,
   * latestSession?.id)`, então a revisão pendente de uma PR proposta numa
   * sessão anterior desaparece assim que uma sessão nova nasce, porque a
   * consulta nem chega a considerá-la. A aba PRs usa isto para achar a
   * `proposed_action` correspondente a um PR (ex.: um `git_merge` pendente)
   * sem depender de qual sessão a propôs. `actionType` opcional filtra por
   * tipo — a aba PRs pede só `git_merge`.
   */
  abstract findPendingByProject(
    projectId: string,
    actionType?: string,
  ): Promise<ProposedAction[]>;
}
