import { Injectable } from '@nestjs/common';
import { TaskRepository } from '../../ports/backlog-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
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
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    taskId: string,
    reason: string,
    diagnosis: string,
    agentId: string,
    origin?: FailureOrigin,
  ) {
    const task = await this.tasks.markBlocked(
      taskId,
      reason,
      diagnosis,
      origin,
    );
    await this.appendEvent.execute(projectId, sessionId, {
      type: 'backlog.task_blocked',
      actor: { kind: 'agent', id: agentId },
      payload: { taskId, reason, diagnosis, origin: origin ?? null },
    });
    return task;
  }
}
