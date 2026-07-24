import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PsychologistHypothesisRepository } from '../../ports/psychologist-hypothesis-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import {
  assertHypothesisTransition,
  InvalidHypothesisTransitionError,
} from '../../../domain/psychologist/hypothesis-lifecycle';

/**
 * O usuário descarta uma hipótese do Psicólogo (Fase 4b) — proposed ->
 * dismissed. Uma hipótese dismissed sai do contexto de "hipóteses
 * anteriores não descartadas" que alimenta análises futuras
 * (GetPsychologistContextUseCase.listNonDismissedByProject).
 */
@Injectable()
export class DismissHypothesisUseCase {
  constructor(
    private readonly hypotheses: PsychologistHypothesisRepository,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
  ) {}

  async execute(projectId: string, hypothesisId: string, userId: string) {
    const hypothesis = await this.hypotheses.findById(hypothesisId);
    if (!hypothesis || hypothesis.projectId !== projectId) {
      throw new NotFoundException('Hipótese não encontrada');
    }

    try {
      assertHypothesisTransition(hypothesis.status, 'dismissed');
    } catch (error) {
      if (error instanceof InvalidHypothesisTransitionError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const updated = await this.hypotheses.updateStatus(
      hypothesisId,
      'dismissed',
      userId,
      new Date(),
    );

    await this.appendSessionEvent.execute(projectId, updated.sessionId, {
      type: 'psychologist.hypothesis_dismissed',
      actor: { kind: 'user', id: userId },
      payload: { hypothesisId: updated.id, agenteAlvo: updated.agenteAlvo },
    });

    return updated;
  }
}
