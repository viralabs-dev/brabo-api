import { Injectable } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';

/**
 * Leitura da flag global `PSYCHOLOGIST_ENABLED` (RN-454) — sem efeito
 * colateral, ao contrário de `ReanalyzeSessionUseCase`. Existe porque a aba
 * Insights, com zero hipóteses ainda, nunca chega perto do botão
 * "Reanalisar" (só aparece quando há uma rodada de análise para
 * reprocessar) e por isso nunca esbarrava no 503 que denunciava a pausa —
 * o estado "sem hipóteses ainda" da tela era indistinguível de "pausado por
 * decisão", que é dishonesto pelo mesmo padrão da RN-088/RN-107.
 */
@Injectable()
export class GetPsychologistStatusUseCase {
  constructor(private readonly engineClient: ApiToEngineClient) {}

  async execute(): Promise<{ enabled: boolean }> {
    return this.engineClient.getPsychologistStatus();
  }
}
