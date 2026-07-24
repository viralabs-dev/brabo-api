import { Injectable } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';

/**
 * Reprocessamento explícito da análise do Psicólogo (Fase 4b) — ação
 * humana de custo real (roda o ToolLoop de novo, gasta orçamento de
 * novo). Sem trabalho no lado da api: o engine enfileira o job do
 * PsychologistWorker com `triggeredBy: "manual"` (sempre roda,
 * independente de já haver análise current — ver ProposeHypothesesUseCase,
 * que marca a antiga superseded em vez de apagar).
 */
@Injectable()
export class ReanalyzeSessionUseCase {
  constructor(private readonly engineClient: ApiToEngineClient) {}

  async execute(projectId: string, sessionId: string) {
    await this.engineClient.reanalyzeSession(projectId, sessionId);
    return { ok: true as const };
  }
}
