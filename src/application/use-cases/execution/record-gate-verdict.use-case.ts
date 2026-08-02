import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TaskRepository } from '../../ports/backlog-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { ProvisionedRepositoryRepository } from '../../ports/provisioned-repository-repository.port';
import { GitProviderRegistry } from '../../ports/git-provider.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { MarkTaskBlockedUseCase } from './mark-task-blocked.use-case';
import {
  nextGateStatus,
  type GateName,
  type GateVerdict,
} from '../../../domain/execution/pr-gate-state-machine';
import type { Task } from '../../../domain/backlog/backlog.entity';

// Configurável na ativação (ActivateExecutionUseCase), mesmo espírito do
// DEFAULT_TASK_BUDGET_MICROS: um teto sensato quando o usuário não escolhe.
export const DEFAULT_MAX_GATE_CORRECTIONS = 3;

export type GateNextAction = 'correct' | 'run_secops' | 'done' | 'blocked';

export interface RecordGateVerdictInput {
  taskId: string;
  gate: GateName;
  veredito: GateVerdict;
  resumo: string;
  itens: string[];
}

export interface RecordGateVerdictResult {
  nextAction: GateNextAction;
  task: Task;
}

/**
 * Único lugar que decide o desfecho de um parecer de gate (Fase 4a): aplica
 * `nextGateStatus` (domínio puro), atualiza a task, posta um comentário na
 * PR (best-effort — falha ao comentar NUNCA trava a decisão do gate, só é
 * engolida), e devolve pro engine QUAL a próxima ação — o engine é quem
 * dispara `DevAgentServer.correct/3`/o próximo gate/nada, mesmo princípio
 * de sempre (api decide, engine executa).
 */
@Injectable()
export class RecordGateVerdictUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly proposedActions: ProposedActionRepository,
    private readonly repositories: ProvisionedRepositoryRepository,
    private readonly gitProviders: GitProviderRegistry,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly markTaskBlocked: MarkTaskBlockedUseCase,
    private readonly outbox: OutboxRepository,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    input: RecordGateVerdictInput,
    maxCorrections: number = DEFAULT_MAX_GATE_CORRECTIONS,
  ): Promise<RecordGateVerdictResult> {
    const task = await this.tasks.findById(input.taskId);
    if (!task) {
      throw new NotFoundException(`Task "${input.taskId}" não encontrada`);
    }
    if (!task.gateStatus) {
      throw new BadRequestException(
        `Task "${input.taskId}" não tem gate de PR aberto`,
      );
    }

    // Capturado ANTES de qualquer mutação: `markTaskBlocked.execute` zera
    // `assignedTo` quando o transition é `blocked`, e é esse agente que a
    // Fase 12b precisa acordar com o outbox `task.gate_resolved`.
    const agentId = task.assignedTo;

    const transition = nextGateStatus(
      task.gateStatus,
      input.gate,
      input.veredito,
      task.gateCorrectionCount,
      maxCorrections,
    );

    // FORA da transação abaixo, de propósito: é uma chamada de REDE ao
    // provider de git, e segurar uma conexão do pool durante um round-trip
    // HTTP é como se esgota o pool. Já é best-effort e engolida.
    await this.postComment(projectId, input);

    // Daqui pra baixo, tudo numa transação só (D7): a mudança de estado da
    // task, o evento e a linha de outbox que ACORDA o agente. Perder a última
    // depois de commitar a primeira deixa o agente preso em `awaiting_gate`
    // sem saída, e não existe sweeper que resgate.
    return this.unitOfWork.runInTransaction(async () => {
      let updatedTask: Task;
      let nextAction: GateNextAction;

      if (transition.status === 'blocked') {
        updatedTask = await this.markTaskBlocked.execute(
          projectId,
          sessionId,
          task.id,
          'ciclo de correção esgotado (gate)',
          input.resumo,
          `${input.gate}-agent`,
        );
        nextAction = 'blocked';
      } else {
        updatedTask = await this.tasks.updateGateStatus(
          task.id,
          transition.status,
          transition.correctionCount,
        );
        nextAction =
          input.veredito === 'changes_requested'
            ? 'correct'
            : transition.status === 'awaiting_secops'
              ? 'run_secops'
              : 'done';
      }

      await this.appendEvent.execute(projectId, sessionId, {
        type: 'pr.gate_changed',
        actor: { kind: 'agent', id: `${input.gate}-agent` },
        payload: {
          taskId: task.id,
          gate: input.gate,
          veredito: input.veredito,
          gateStatus: updatedTask.gateStatus,
          blocked: updatedTask.blocked,
        },
      });

      // Fase 12b (RN-047, ADR 0045): só os desfechos TERMINAIS viajam por
      // outbox — `correct`/`run_secops` continuam tratados em processo pelo
      // engine (QaLeadServer/SecOpsAgentServer), sem outbox nenhum. É a prova
      // mecânica de que reagendar não duplica esse caminho: não existe linha
      // pra ele acionar duas vezes.
      //
      // `blocked` NÃO entra aqui: esse ramo delega a `MarkTaskBlockedUseCase`,
      // que emite a linha ele mesmo desde a correção D3 — é por lá que passam
      // TAMBÉM os bloqueios que nunca chegam a este caso de uso (o
      // `QaLeadServer` falhando internamente). Emitir nos dois lugares daria
      // duas linhas para o mesmo desfecho.
      if (agentId && nextAction === 'done') {
        await this.outbox.append({
          aggregateType: 'task',
          aggregateId: task.id,
          eventType: 'task.gate_resolved',
          payload: {
            projectId,
            sessionId,
            taskId: task.id,
            agentId,
            gate: input.gate,
            veredito: input.veredito,
            nextAction,
          },
        });
      }

      return { nextAction, task: updatedTask };
    });
  }

  // Falha ao comentar (rede, credencial, provider fora do ar) NUNCA impede
  // a decisão do gate — é best-effort, mesmo espírito de outros pontos que
  // nunca deixam uma ação presa por causa de um efeito colateral externo.
  private async postComment(
    projectId: string,
    input: RecordGateVerdictInput,
  ): Promise<void> {
    try {
      const repo = await this.repositories.findByProjectId(projectId);
      if (!repo) return;

      const prActions = await this.proposedActions.listByProjectAndType(
        projectId,
        'pr_open',
      );
      const prAction = prActions
        .filter(
          (a) =>
            (a.payload as { storyTaskId?: string }).storyTaskId ===
            input.taskId,
        )
        .sort((a, b) => b.seq - a.seq)[0];
      const executionResult = prAction?.executionResult;
      const pullRequestId =
        executionResult &&
        'kind' in executionResult &&
        executionResult.kind === 'pr_open'
          ? executionResult.pullRequestId
          : undefined;
      if (!pullRequestId) return;

      const provider = this.gitProviders.get(repo.provider);
      await provider.commentOnPullRequest({
        externalId: repo.externalId,
        pullRequestId,
        body: commentBody(input),
      });
    } catch {
      // best-effort — ver comentário acima do método.
    }
  }
}

function commentBody(input: RecordGateVerdictInput): string {
  const gateLabel = input.gate === 'qa' ? 'QA' : 'SecOps';
  const veredictoLabel =
    input.veredito === 'approved' ? 'Aprovado ✅' : 'Mudanças solicitadas ⚠️';
  const itens =
    input.itens.length > 0
      ? '\n' + input.itens.map((i) => `- ${i}`).join('\n')
      : '';
  return `### Parecer ${gateLabel}: ${veredictoLabel}\n\n${input.resumo}${itens}`;
}
