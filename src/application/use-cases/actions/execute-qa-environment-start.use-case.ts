import { ConflictException, Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { InstanciaDeQaUseCase } from '../containers/instancia-de-qa.use-case';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';

/**
 * Executa `qa_environment_start` (AT-612, ADR 0229, RN-936): sobe a instância
 * de QA efêmera da tarefa do payload (`{ taskId }`). Semeada `auto_approve`
 * para o `qa-automacao`. Falha (teto ocupado, runner, broker) vira `failed`
 * com o motivo (e, no teto, o `codigo` `instancia_de_qa_ocupada`), que chega ao modelo como resultado da ferramenta.
 */
@Injectable()
export class ExecuteQaEnvironmentStartUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly proposedActions: ProposedActionRepository,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly outbox: OutboxRepository,
    private readonly instancia: InstanciaDeQaUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    action: ProposedAction,
  ): Promise<ProposedAction> {
    const taskId = (action.payload as { taskId?: unknown } | null)?.taskId;
    let motivo: string | null;
    let chave: string | null = null;
    let codigo: string | null = null;
    if (typeof taskId !== 'string') {
      motivo = '`taskId` é obrigatório no payload.';
    } else {
      try {
        const r = await this.instancia.start(projectId, taskId);
        motivo = r.sucesso ? null : r.motivo;
        chave = r.chave;
      } catch (e) {
        // Só a recusa por teto ganha código: o engine espera a vez em vez de bloquear (RN-936).
        if (e instanceof ConflictException) {
          const corpo = e.getResponse() as { code?: unknown };
          if (corpo.code === 'instancia_de_qa_ocupada') codigo = corpo.code;
        }
        motivo = e instanceof Error ? e.message : String(e);
      }
    }
    const status = motivo === null ? 'executed' : 'failed';
    return this.unitOfWork.runInTransaction(async () => {
      const updated = await this.proposedActions.updateExecutionResult(
        action.id,
        {
          status,
          executionResult: {
            motivo,
            ...(codigo ? { codigo } : {}),
            statusFinal: status === 'executed' ? 'running' : null,
          },
        },
      );
      await this.appendSessionEvent.execute(projectId, sessionId, {
        type:
          status === 'executed'
            ? 'qa_environment.started'
            : 'qa_environment.start_failed',
        actor: { kind: 'system', id: 'action-executor' },
        payload: { actionId: action.id, chave, motivo },
      });
      await this.outbox.append({
        aggregateType: 'proposed_action',
        aggregateId: action.id,
        eventType:
          status === 'executed'
            ? 'proposed_action.executed'
            : 'proposed_action.failed',
        payload: { actionId: action.id },
      });
      return updated;
    });
  }
}
