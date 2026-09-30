import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { AppendSessionEventUseCase } from './append-session-event.use-case';
import {
  assertReopen,
  InvalidSessionTransitionError,
} from '../../../domain/sessions/session-state-machine';
import {
  EVENTO_DE_REABERTURA,
  EVENTO_QUE_IMPEDE_REABRIR,
  garantirQueSessaoSemExecucaoReabre,
  payloadDaReabertura,
  SessaoComExecucaoNaoReabreError,
} from '../../../domain/sessions/reabertura-de-sessao';
import type { Session } from '../../../domain/sessions/session.entity';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

/**
 * Reabre uma sessão `closed`/`closed_abnormally` (ADR 0183, RN-649/RN-650).
 *
 * A sessão volta a `active` com TUDO que ela já tinha — o event log inteiro,
 * os artefatos (que são eventos), as perguntas respondidas, os handoffs. Nada
 * é copiado para uma sessão nova: a ativação de um agente exige handoff
 * `accepted` na PRÓPRIA sessão, e o kickoff do PO lê brief e regras da sessão.
 *
 * O que muda na linha de `sessions` é só estado (`status`, `closed_at` e
 * `termination_reason` limpos); o fechamento anterior fica no log, num evento
 * NOVO — `session.reopened` —, com o `closed_at` e a causa que a coluna perde.
 * O `kind` não é tocado (RN-097).
 *
 * Mesmo desenho de `TransitionSessionUseCase.activate`: o engine é chamado
 * ANTES da transação, e uma falha dele deixa a sessão encerrada como estava,
 * em vez de `active` sem processo. Sob lock, tudo é revalidado.
 */
@Injectable()
export class ReopenSessionUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly sessions: SessionRepository,
    private readonly sessionEvents: SessionEventRepository,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly engineClient: ApiToEngineClient,
  ) {}

  @Traced('application')
  async execute(
    projectId: string,
    sessionId: string,
    userId: string,
  ): Promise<Session> {
    const current = await this.sessions.findInProject(projectId, sessionId);
    if (!current) throw new NotFoundException('Sessão não encontrada');
    await this.garantirQuePodeReabrir(current);

    await this.engineClient.startSession(
      sessionId,
      projectId,
      current.traceParent,
    );

    return this.unitOfWork.runInTransaction(async () => {
      const locked = await this.sessions.findInProjectForUpdate(
        projectId,
        sessionId,
      );
      if (!locked) throw new NotFoundException('Sessão não encontrada');
      await this.garantirQuePodeReabrir(locked);

      const reaberta = await this.sessions.updateStatus(
        sessionId,
        'active',
        null,
        null,
      );

      // No MESMO contador `seq` (RN-002), pelo funil de sempre: a sessão já
      // está `active` quando o `incrementSeq` lê o estado, e o aviso ao canal
      // (AT-157) sai depois do commit.
      await this.appendSessionEvent.execute(projectId, sessionId, {
        type: EVENTO_DE_REABERTURA,
        actor: { kind: 'user', id: userId },
        payload: payloadDaReabertura(locked),
      });

      return reaberta;
    });
  }

  private async garantirQuePodeReabrir(sessao: Session): Promise<void> {
    try {
      assertReopen(sessao.status);
      const execucao = await this.sessionEvents.findLatestOfTypesInSession(
        sessao.id,
        [EVENTO_QUE_IMPEDE_REABRIR],
      );
      garantirQueSessaoSemExecucaoReabre(sessao.status, execucao !== null);
    } catch (error) {
      if (error instanceof InvalidSessionTransitionError) {
        throw new ConflictException({
          message:
            `Só sessão encerrada pode ser reaberta; esta está ` +
            `"${error.from}".`,
          reason: 'sessao_nao_encerrada',
          status: error.from,
        });
      }
      if (error instanceof SessaoComExecucaoNaoReabreError) {
        throw new ConflictException({
          message: error.message,
          reason: SessaoComExecucaoNaoReabreError.REASON,
          status: error.status,
        });
      }
      throw error;
    }
  }
}
