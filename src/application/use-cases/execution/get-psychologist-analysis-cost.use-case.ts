import { Injectable } from '@nestjs/common';
import { TokenUsageRepository } from '../../ports/token-usage-repository.port';

// Os dois agent ids que o Psicólogo usa conforme a triagem (Fase 4b) —
// ver Engine.Psychologist.Triage.decide/1.
const PSYCHOLOGIST_ACTOR_IDS = ['psicologo', 'psicologo-leve'];

/**
 * Custo (em micro-USD) da análise do Psicólogo pra uma sessão — soma
 * direto de token_usage (RunLlmTurnUseCase já grava incondicionalmente),
 * sem mecanismo de custo paralelo. É o número que a UI mostra no card de
 * Insight, e o que torna "custos distintos entre triagem leve e pesada"
 * checável (modelos diferentes por tier já produzem custos diferentes).
 */
@Injectable()
export class GetPsychologistAnalysisCostUseCase {
  constructor(private readonly tokenUsage: TokenUsageRepository) {}

  execute(sessionId: string): Promise<number> {
    return this.tokenUsage.sumBySessionAndActorIds(
      sessionId,
      PSYCHOLOGIST_ACTOR_IDS,
    );
  }
}
