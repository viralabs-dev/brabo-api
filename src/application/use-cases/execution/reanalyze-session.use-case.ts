import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { PsychologistDisabledError } from '../../../domain/psychologist/psychologist-disabled.error';

/**
 * Reprocessamento explícito da análise do Psicólogo (Fase 4b) — ação
 * humana de custo real (roda o ToolLoop de novo, gasta orçamento de
 * novo). Sem trabalho no lado da api: o engine enfileira o job do
 * PsychologistWorker com `triggeredBy: "manual"` (sempre roda,
 * independente de já haver análise current — ver ProposeHypothesesUseCase,
 * que marca a antiga superseded em vez de apagar).
 *
 * O Psicólogo pode estar PAUSADO globalmente (`PSYCHOLOGIST_ENABLED=false`
 * no engine — decisão do usuário em 2026-08-10, mesmo padrão da Anamnese,
 * ver docs/explanation/backlog.md). Este caso vira 503 com uma mensagem
 * clara, nunca um 500 genérico.
 */
@Injectable()
export class ReanalyzeSessionUseCase {
  constructor(private readonly engineClient: ApiToEngineClient) {}

  async execute(projectId: string, sessionId: string) {
    try {
      await this.engineClient.reanalyzeSession(projectId, sessionId);
    } catch (erro) {
      if (erro instanceof PsychologistDisabledError) {
        throw new ServiceUnavailableException({
          message:
            'O Psicólogo está desativado globalmente por decisão do usuário — aguardando refinamento futuro.',
          reason: 'psychologist_disabled',
        });
      }
      throw erro;
    }
    return { ok: true as const };
  }
}
