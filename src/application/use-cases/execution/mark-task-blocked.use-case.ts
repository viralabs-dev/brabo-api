import { Injectable, Logger } from '@nestjs/common';
import { TaskRepository } from '../../ports/backlog-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { EscalarModeloDaTarefaUseCase } from './escalar-modelo-da-tarefa.use-case';
import { UnblockTaskUseCase } from './unblock-task.use-case';
import { OferecerAutomacaoUseCase } from '../automacao/oferecer-automacao.use-case';
import { ehBloqueioPorLimiteDeIteracoes } from '../../../domain/execution/escada-de-modelos';
import {
  validarExplicacaoDoBloqueio,
  type ExplicacaoDoBloqueio,
} from '../../../domain/backlog/explicacao-do-bloqueio';
import type { FailureOrigin } from '../../../domain/agents/failure-origin';

/**
 * O DevAgent não conseguiu concluir a task (Fase 4a) — devolve pra `todo`
 * com diagnóstico, sem dono. Fica EXCLUÍDA do próximo claim automático
 * (`ClaimNextTaskUseCase`/`claimNext`) até um humano ler o diagnóstico e
 * liberar via `UnblockTaskUseCase` — nunca reclaim silencioso em loop.
 *
 * `origin` (Fase 8b, ADR 0020/0038): a ORIGEM da falha, quando conhecida.
 * Parâmetro OPCIONAL de propósito — nasce `undefined` pra todo call site já
 * existente (o `RecordGateVerdictUseCase` no ciclo de correção esgotado, e
 * os ~18 pontos de bloqueio do Dev na Fase 4a, nenhum retrofitado nesta
 * entrega). Só o `QaLeadServer` chama já sabendo a origem, porque a recebe
 * do subagente que falhou.
 */
@Injectable()
export class MarkTaskBlockedUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly outbox: OutboxRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly escalada: EscalarModeloDaTarefaUseCase,
    private readonly desbloquear?: UnblockTaskUseCase,
    private readonly ofertas?: OferecerAutomacaoUseCase,
  ) {}

  private readonly logger = new Logger(MarkTaskBlockedUseCase.name);

  async execute(
    projectId: string,
    sessionId: string,
    taskId: string,
    reason: string,
    diagnosis: string,
    agentId: string,
    origin?: FailureOrigin,
    explicacaoBruta?: unknown,
  ) {
    // RN-1527: fronteira de confiança. Explicação fora da regra de linguagem é
    // DESCARTADA e o bloqueio acontece mesmo assim (é o desfecho seguro).
    let explicacao: ExplicacaoDoBloqueio | null = null;
    if (explicacaoBruta !== undefined && explicacaoBruta !== null) {
      const v = validarExplicacaoDoBloqueio(explicacaoBruta);
      if (v.ok) explicacao = v.valor;
      else
        this.logger.warn(
          `explicação do bloqueio da task ${taskId} descartada: ${v.motivo}`,
        );
    }
    // Bloqueio e wake na MESMA transação (D7): sem isto, uma falha entre as
    // duas escritas bloqueia a task na api e nunca acorda o agente, que fica
    // em `awaiting_gate` sem saída — e não existe sweeper que resgate.
    // `runInTransaction` é reentrante, então o `appendEvent` aqui dentro
    // reusa esta transação em vez de abrir outra.
    const { task, owner } = await this.unitOfWork.runInTransaction(async () => {
      // O DONO da task, lido ANTES de `markBlocked` zerar `assignedTo`. NÃO é
      // o mesmo que o `agentId` do parâmetro, que é QUEM BLOQUEOU
      // (`qa-lead`, `qa-agent`, o próprio dev...). É o dono que precisa ser
      // acordado.
      const owner = (await this.tasks.findById(taskId))?.assignedTo ?? null;

      const task = await this.tasks.markBlocked(
        taskId,
        reason,
        diagnosis,
        origin,
        explicacao,
      );
      await this.appendEvent.execute(projectId, sessionId, {
        type: 'backlog.task_blocked',
        actor: { kind: 'agent', id: agentId },
        payload: {
          taskId,
          reason,
          diagnosis,
          origin: origin ?? null,
          explicacao,
        },
      });

      // Fase 12b (correção pós-revisão, D3): TODO bloqueio externo passa por
      // aqui — inclusive o do `QaLeadServer`, que chama este caso de uso
      // DIRETO sem passar pelo `RecordGateVerdictUseCase`. Sem esta emissão,
      // o dev agent ficava em `awaiting_gate` PARA SEMPRE quando um gate
      // falhava internamente: a task era bloqueada na api e o agente nunca
      // ficava sabendo (e o breaker também não contava).
      //
      // Emitir também quando quem bloqueou é o PRÓPRIO dev é inofensivo: ele
      // já tratou localmente por `finish_task/2` e o guard de identidade
      // (`task_id` batendo + `awaiting_gate`) transforma o wake em no-op.
      if (owner) {
        await this.outbox.append({
          aggregateType: 'task',
          aggregateId: taskId,
          eventType: 'task.gate_resolved',
          payload: {
            projectId,
            sessionId,
            taskId,
            agentId: owner,
            gate: null,
            veredito: null,
            nextAction: 'blocked',
            // AT-984: o engine decide se o bloqueio conta no disjuntor do dev.
            origin: origin ?? null,
            blockedBy: agentId,
          },
        });
      }

      return { task, owner };
    });

    // RN-1143 (AT-916): FORA da transação — falha da escalada nunca desfaz o
    // bloqueio, que é o desfecho seguro.
    if (ehBloqueioPorLimiteDeIteracoes(reason, origin)) {
      try {
        await this.escalada.aoBloquearPorLimite(
          projectId,
          sessionId,
          taskId,
          owner ?? agentId,
        );
      } catch (err) {
        this.logger.warn(
          `escalada_falhou taskId=${taskId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    await this.aplicarRegraDeDesbloqueio(projectId, sessionId, taskId, reason);
    return task;
  }

  /**
   * AT-998 (RN-1438): a regra que a pessoa aceitou ("liberar sozinho quando for
   * este motivo") desbloqueia UMA vez por tarefa — se ela voltar a bloquear, o
   * laço não se automatiza e a decisão volta para a pessoa (anti-laço).
   * FORA da transação e em melhor esforço: o bloqueio é o desfecho seguro.
   */
  private async aplicarRegraDeDesbloqueio(
    projectId: string,
    sessionId: string,
    taskId: string,
    reason: string,
  ) {
    if (!this.ofertas || !this.desbloquear) return;
    try {
      const regra = await this.ofertas.regraDoDesbloqueio(
        projectId,
        taskId,
        reason,
      );
      if (!regra) return;
      await this.desbloquear.execute(
        projectId,
        sessionId,
        taskId,
        'automacao-oferta',
        { kind: 'system' },
        undefined,
        true,
      );
      await this.ofertas.registrarAplicada(projectId, sessionId, {
        categoria: 'desbloqueio',
        taskId,
        regra: regra.chave,
        regraDesde: regra.alteradaEm,
      });
    } catch (err) {
      this.logger.warn(
        `desbloqueio_automatico_falhou taskId=${taskId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
