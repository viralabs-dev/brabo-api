import { Injectable } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';

/**
 * Dispara uma rodada da Anamnese AGORA (Fase 4b — fechamento).
 *
 * Sem isto, a única forma de uma rodada acontecer era o tick de 15 minutos do
 * scheduler no engine, o que tornava o critério de aceite impraticável de
 * exercitar. Calibrado em `maintainer` no controller pela mesma razão que a
 * reanálise do Psicólogo: roda o ToolLoop e gasta orçamento de verdade.
 */
@Injectable()
export class RunAnamneseUseCase {
  constructor(private readonly engineClient: ApiToEngineClient) {}

  async execute(projectId: string) {
    await this.engineClient.runAnamnese(projectId);
    return { ok: true as const };
  }
}
