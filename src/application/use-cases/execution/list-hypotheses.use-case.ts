import { Injectable } from '@nestjs/common';
import { PsychologistHypothesisRepository } from '../../ports/psychologist-hypothesis-repository.port';
import type { PsychologistHypothesis } from '../../../domain/psychologist/psychologist-hypothesis.entity';

/**
 * Lista as hipóteses de análises CURRENT (não superseded) do projeto —
 * seção Insights da UI. Agrupamento por agenteAlvo fica no front.
 */
@Injectable()
export class ListHypothesesUseCase {
  constructor(private readonly hypotheses: PsychologistHypothesisRepository) {}

  execute(projectId: string): Promise<PsychologistHypothesis[]> {
    return this.hypotheses.listCurrentByProject(projectId);
  }
}
