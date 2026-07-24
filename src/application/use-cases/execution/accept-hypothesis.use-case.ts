import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PsychologistHypothesisRepository } from '../../ports/psychologist-hypothesis-repository.port';
import { AnamneseQueueRepository } from '../../ports/anamnese-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import {
  assertHypothesisTransition,
  InvalidHypothesisTransitionError,
} from '../../../domain/psychologist/hypothesis-lifecycle';

/**
 * O usuário aceita uma hipótese do Psicólogo (Fase 4b) — proposed ->
 * accepted. Emite `psychologist.hypothesis_accepted` (auditoria) e um
 * SEGUNDO evento, `psychologist.hypothesis_accepted_for_anamnese` (tipo
 * distinto, não uma flag no payload — trivialmente filtrável por um
 * futuro consumidor da Fase 4.6, que ainda não existe: só o ponto de
 * emissão nasce aqui).
 */
@Injectable()
export class AcceptHypothesisUseCase {
  constructor(
    private readonly hypotheses: PsychologistHypothesisRepository,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly anamneseQueue: AnamneseQueueRepository,
  ) {}

  async execute(projectId: string, hypothesisId: string, userId: string) {
    const hypothesis = await this.hypotheses.findById(hypothesisId);
    if (!hypothesis || hypothesis.projectId !== projectId) {
      throw new NotFoundException('Hipótese não encontrada');
    }

    try {
      assertHypothesisTransition(hypothesis.status, 'accepted');
    } catch (error) {
      if (error instanceof InvalidHypothesisTransitionError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const updated = await this.hypotheses.updateStatus(
      hypothesisId,
      'accepted',
      userId,
      new Date(),
    );

    const payload = {
      hypothesisId: updated.id,
      agenteAlvo: updated.agenteAlvo,
    };

    await this.appendSessionEvent.execute(projectId, updated.sessionId, {
      type: 'psychologist.hypothesis_accepted',
      actor: { kind: 'user', id: userId },
      payload,
    });

    await this.appendSessionEvent.execute(projectId, updated.sessionId, {
      type: 'psychologist.hypothesis_accepted_for_anamnese',
      actor: { kind: 'user', id: userId },
      payload,
    });

    // Loop fechado (Fase 4b): a hipótese aceita vira input PRIORIZADO da
    // próxima rodada da Anamnese. Enfileirar aqui é determinístico —
    // não depende de rotear o outbox nem de o consumidor estar de pé.
    // Idempotente por hypothesisId (unique + doNothing).
    await this.anamneseQueue.enqueueHypothesis(projectId, updated.id);

    return updated;
  }
}
