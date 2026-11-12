import { Injectable, Logger } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { ModelBindingRepository } from '../../ports/model-binding-repository.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import { TaskModelEscalationRepository } from '../../ports/task-model-escalation-repository.port';
import { ResolveModelBindingUseCase } from '../llm/resolve-model-binding.use-case';
import { SetModelBindingUseCase } from '../llm/set-model-binding.use-case';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { UnblockTaskUseCase } from './unblock-task.use-case';
import { DEFAULT_TASK_BUDGET_MICROS } from './activate-execution.use-case';
import { chaveDeAgente } from '../../../domain/llm/binding-scope-id';
import {
  BLOQUEIOS_POR_LIMITE_ATE_ESCALAR,
  ESCADA_PADRAO,
} from '../../../domain/execution/escada-de-modelos';
import type { RoutingPreference } from '@brabo/shared';

export type DesfechoDaEscalada =
  'contado' | 'escalado' | 'escada_esgotada' | 'fora_da_escada';

/**
 * RN-1156/RN-1157 (AT-916): depois de N=2 bloqueios por limite de iterações na
 * MESMA tarefa, o agente sobe um degrau da escada do projeto: troca o
 * `agent-binding`, aplica o teto do degrau e desbloqueia a tarefa. Quando a
 * tarefa fecha, `restaurar` devolve o modelo base e o teto do projeto. O
 * engine não muda: o binding é resolvido pela api a cada `llm-turn`.
 */
@Injectable()
export class EscalarModeloDaTarefaUseCase {
  private readonly logger = new Logger(EscalarModeloDaTarefaUseCase.name);

  constructor(
    private readonly projects: ProjectRepository,
    private readonly estado: TaskModelEscalationRepository,
    private readonly resolve: ResolveModelBindingUseCase,
    private readonly bindings: ModelBindingRepository,
    private readonly setBinding: SetModelBindingUseCase,
    private readonly engine: ApiToEngineClient,
    private readonly unblock: UnblockTaskUseCase,
    private readonly appendEvent: AppendSessionEventUseCase,
  ) {}

  async aoBloquearPorLimite(
    projectId: string,
    sessionId: string,
    taskId: string,
    agentId: string,
  ): Promise<DesfechoDaEscalada> {
    const project = await this.projects.findById(projectId);
    if (!project) return 'fora_da_escada';
    const linha = await this.estado.registrarBloqueio(
      taskId,
      projectId,
      agentId,
    );
    if (linha.limitBlocks < BLOQUEIOS_POR_LIMITE_ATE_ESCALAR) return 'contado';

    const ladder = (project.modelEscalation ?? ESCADA_PADRAO).ladder;
    const atual = await this.resolve.execute({
      projectId,
      agentId,
      exigeToolCalling: true,
    });
    const idx = ladder.findIndex((d) => d.modelId === atual?.modelId);
    if (idx < 0) return 'fora_da_escada';

    const proximo = ladder[idx + 1];
    if (!proximo) {
      await this.appendEvent.execute(projectId, sessionId, {
        type: 'agent.model_escalation_exhausted',
        actor: { kind: 'system', id: 'model-escalation' },
        payload: {
          agentId,
          taskId,
          modelId: atual?.modelId,
          motivo: 'escada esgotada',
        },
      });
      return 'escada_esgotada';
    }

    const chave = chaveDeAgente(projectId, agentId);
    const proprio = await this.bindings.findOne('agent', chave);
    await this.setBinding.execute(
      'agent',
      chave,
      proximo.modelId,
      project.createdBy,
    );
    await this.estado.marcarEscalada(taskId, {
      modelId: proprio?.modelId ?? null,
      routingPreference: proprio?.routingPreference ?? null,
    });
    await this.aplicarTeto(projectId, proximo.taskBudgetMicros);
    await this.appendEvent.execute(projectId, sessionId, {
      type: 'agent.model_escalated',
      actor: { kind: 'system', id: 'model-escalation' },
      payload: {
        agentId,
        taskId,
        de: atual?.modelId ?? null,
        para: proximo.modelId,
        tetoMicros: proximo.taskBudgetMicros,
      },
    });
    await this.unblock.execute(
      projectId,
      sessionId,
      taskId,
      'model-escalation',
      {
        kind: 'system',
      },
    );
    return 'escalado';
  }

  /** A tarefa fechou: volta ao modelo base e ao teto do projeto. */
  async restaurar(projectId: string, taskId: string): Promise<void> {
    const linha = await this.estado.find(taskId);
    if (!linha) return;
    try {
      if (linha.escalated) {
        const chave = chaveDeAgente(projectId, linha.agentId);
        const project = await this.projects.findById(projectId);
        if (linha.baseModelId === null) {
          await this.bindings.remove('agent', chave);
        } else {
          await this.bindings.upsert({
            scope: 'agent',
            scopeId: chave,
            modelId: linha.baseModelId,
            routingPreference:
              (linha.baseRoutingPreference as RoutingPreference | null) ?? null,
            createdBy: project?.createdBy ?? '',
          });
        }
        await this.aplicarTeto(
          projectId,
          project?.taskBudgetMicros ?? DEFAULT_TASK_BUDGET_MICROS,
        );
      }
    } finally {
      await this.estado.remove(taskId);
    }
  }

  // O engine é best-effort, como na AT-917: não desfaz a escalada.
  private async aplicarTeto(projectId: string, micros: number) {
    try {
      await this.engine.setTaskBudget(projectId, micros);
    } catch (err) {
      this.logger.warn(
        `teto_nao_propagado projectId=${projectId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
