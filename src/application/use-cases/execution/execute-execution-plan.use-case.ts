import { HttpException, Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { TaskRepository } from '../../ports/backlog-repository.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { ActivateExecutionUseCase } from './activate-execution.use-case';
import {
  idsDasTarefasDoPlano,
  lerPlanoDeExecucao,
} from '../../../domain/execution/plano-de-execucao';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';
import type { ExecutionPlanExecutionResult } from '../../../domain/execution/execution-plan-execution-result';

/**
 * O que acontece quando o humano APROVA o plano do Dev Lead (AT-263/AT-274,
 * RN-677/RN-678, ADR 0194) — o `propose_execution_plan` deixou de ser uma
 * aprovação sem consumidor.
 *
 * Até aqui o plano ficava `approved` para sempre e a execução subia por outro
 * gesto: o web encadeava `POST .../execution/activate` no ACEITE do handoff ao
 * Dev Lead (RN-161), antes de o plano existir — no uso real de 29/09 a
 * execução foi ativada às 06:45:01 e o plano, proposto às 06:47:47, nunca foi
 * usado. Decisão do dono (01/10): aceitar o Dev Lead só o traz para PLANEJAR;
 * a ativação é a aprovação do plano.
 *
 * Duas coisas, nesta ordem:
 *
 * 1. As tarefas ganham o MÓDULO que o Dev Lead atribuiu (RN-678). O plano é
 *    relido contra o `module_map` VIGENTE — ele pode ter mudado desde a
 *    proposta —, e recusa nomeada vira `failed` sem gravar nada. Atribuir
 *    ANTES de ativar é o que impede um dev agent recém-subido de procurar
 *    tarefa antes de ela ter dono.
 * 2. A execução é ATIVADA pelo MESMO `ActivateExecutionUseCase` do botão
 *    (nenhuma segunda régua): o 409 sem repositório (RN-582), o 409 de sessão
 *    consultiva (RN-097) e a reativação idempotente por
 *    `findActiveExecutionSession` continuam lá. Quem ativa é QUEM APROVOU
 *    (`decidedBy`) — ou, na auto-aprovação, quem abriu a sessão, que é contra
 *    quem `decide()` resolveu o papel (`maintainer`, o mesmo do endpoint).
 *    A sessão do Dev Lead NÃO é passada como `originSessionId`: é nela que ele
 *    retoma o turno e narra o desfecho, e fechá-la cortaria essa narração.
 *
 * Nunca lança: falha vira `executionResult` `failed` com o motivo — a decisão
 * do humano já está gravada, e o Dev Lead precisa ler POR QUE nada subiu.
 */
@Injectable()
export class ExecuteExecutionPlanUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly proposedActions: ProposedActionRepository,
    private readonly outbox: OutboxRepository,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly moduleMaps: ModuleMapRepository,
    private readonly tasks: TaskRepository,
    private readonly sessions: SessionRepository,
    private readonly activateExecution: ActivateExecutionUseCase,
  ) {}

  /**
   * A MESMA leitura, na PROPOSTA (`ProposeActionUseCase`): o motivo nomeado
   * quando o plano não serve — tarefa sem módulo, módulo fora do `module_map`
   * —, ou `null`. É ela que faz a recusa chegar ao Dev Lead como resultado da
   * ferramenta, em vez de virar uma aprovação que falharia depois.
   */
  async recusaNaProposta(
    projectId: string,
    payload: unknown,
  ): Promise<string | null> {
    const plano = await this.lerPlano(projectId, payload);
    return plano.ok ? null : plano.motivo;
  }

  private async lerPlano(projectId: string, payload: unknown) {
    const moduleMap = await this.moduleMaps.findCurrent(projectId);
    const modulosDoMapa = (moduleMap?.modules ?? []).map((m) => m.name);
    const encontradas = await this.tasks.findInProjectByIds(
      projectId,
      idsDasTarefasDoPlano(payload),
    );
    return lerPlanoDeExecucao(
      payload,
      modulosDoMapa,
      new Set(encontradas.map((t) => t.id)),
    );
  }

  async execute(
    projectId: string,
    sessionId: string,
    action: ProposedAction,
  ): Promise<ProposedAction> {
    try {
      const plano = await this.lerPlano(projectId, action.payload);
      if (!plano.ok) {
        return this.registrar(projectId, sessionId, action.id, 'failed', {
          sessaoDeExecucao: null,
          modulos: [],
          tarefasAtribuidas: 0,
          motivo: plano.motivo,
        });
      }

      await this.tasks.assignModules(
        plano.tarefas.map((t) => ({ taskId: t.taskId, module: t.modulo })),
      );

      const quemAtiva =
        action.decidedBy ??
        (await this.sessions.findInProject(projectId, sessionId))?.createdBy;
      if (!quemAtiva) {
        return this.registrar(projectId, sessionId, action.id, 'failed', {
          sessaoDeExecucao: null,
          modulos: [],
          tarefasAtribuidas: plano.tarefas.length,
          motivo:
            'não há quem ative a execução: a ação não tem decisor e a sessão não foi encontrada',
        });
      }

      // AT-381 (RN-709): só módulo com ≥ 1 tarefa ganha agente — um
      // `dev-<modulo>` sem tarefa sobe, fica ocioso e conta como execução.
      const tarefasPorModulo: Record<string, number> = {};
      for (const t of plano.tarefas) {
        tarefasPorModulo[t.modulo] = (tarefasPorModulo[t.modulo] ?? 0) + 1;
      }
      const modulosDoMapa = (
        (await this.moduleMaps.findCurrent(projectId))?.modules ?? []
      ).map((m) => m.name);
      const modulosSemTarefa =
        plano.tarefas.length === 0
          ? []
          : modulosDoMapa.filter((m) => !(m in tarefasPorModulo));

      const ativacao = await this.activateExecution.execute(
        projectId,
        quemAtiva,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        // Plano sem `tarefas` (forma anterior à RN-678) sobe o mapa inteiro.
        plano.tarefas.length > 0 ? Object.keys(tarefasPorModulo) : undefined,
      );

      return this.registrar(projectId, sessionId, action.id, 'executed', {
        sessaoDeExecucao: ativacao.sessionId,
        modulos: ativacao.modules,
        tarefasAtribuidas: plano.tarefas.length,
        tarefasPorModulo,
        modulosSemTarefa,
      });
    } catch (erro) {
      return this.registrar(projectId, sessionId, action.id, 'failed', {
        sessaoDeExecucao: null,
        modulos: [],
        tarefasAtribuidas: 0,
        motivo: motivoDoErro(erro),
      });
    }
  }

  private registrar(
    projectId: string,
    sessionId: string,
    actionId: string,
    status: 'executed' | 'failed',
    executionResult: ExecutionPlanExecutionResult,
  ) {
    return this.unitOfWork.runInTransaction(async () => {
      const updated = await this.proposedActions.updateExecutionResult(
        actionId,
        { status, executionResult },
      );

      // O desfecho na timeline da sessão do Dev Lead: é ali que o humano
      // aprovou, e "aprovei e nada subiu" precisa do motivo no mesmo lugar.
      await this.appendSessionEvent.execute(projectId, sessionId, {
        type:
          status === 'executed'
            ? 'execution.plan_applied'
            : 'execution.plan_failed',
        actor: { kind: 'system', id: 'action-executor' },
        payload: { actionId, ...executionResult },
      });

      await this.outbox.append({
        aggregateType: 'proposed_action',
        aggregateId: actionId,
        eventType:
          status === 'executed'
            ? 'proposed_action.executed'
            : 'proposed_action.failed',
        payload: { actionId },
      });

      return updated;
    });
  }
}

// A frase da api (`HttpException`) vira o motivo como está — é ela que já diz
// o que falta (o handoff a aceitar, o module_map, a sessão consultiva).
function motivoDoErro(erro: unknown): string {
  if (erro instanceof HttpException) {
    const resposta = erro.getResponse();
    if (typeof resposta === 'string') return resposta;
    const mensagem = (resposta as { message?: unknown }).message;
    if (typeof mensagem === 'string') return mensagem;
    if (Array.isArray(mensagem)) return mensagem.join('; ');
  }
  return erro instanceof Error ? erro.message : String(erro);
}
