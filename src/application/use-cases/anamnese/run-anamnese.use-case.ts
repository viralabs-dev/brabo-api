import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { AnamneseDisabledError } from '../../../domain/anamnese/anamnese-disabled.error';

/**
 * Dispara uma rodada da Anamnese AGORA (Fase 4b — fechamento).
 *
 * Sem isto, a única forma de uma rodada acontecer era o tick de 15 minutos do
 * scheduler no engine, o que tornava o critério de aceite impraticável de
 * exercitar. Calibrado em `maintainer` no controller pela mesma razão que a
 * reanálise do Psicólogo: roda o ToolLoop e gasta orçamento de verdade.
 *
 * A Anamnese pode estar PAUSADA globalmente (`ANAMNESE_ENABLED=false` no
 * engine — decisão do usuário em 2026-08-10, ver docs/explanation/backlog.md).
 * Este caso vira 503 com uma mensagem clara, nunca um 500 genérico nem um 409
 * confundível com "projeto sem sessão".
 */
@Injectable()
export class RunAnamneseUseCase {
  constructor(private readonly engineClient: ApiToEngineClient) {}

  async execute(projectId: string) {
    try {
      await this.engineClient.runAnamnese(projectId);
    } catch (erro) {
      if (erro instanceof AnamneseDisabledError) {
        throw new ServiceUnavailableException({
          message:
            'A Anamnese está desativada globalmente por decisão do usuário — aguardando refinamento futuro.',
          reason: 'anamnese_disabled',
        });
      }
      throw erro;
    }
    return { ok: true as const };
  }
}
