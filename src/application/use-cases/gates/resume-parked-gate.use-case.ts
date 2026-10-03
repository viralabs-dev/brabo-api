import { ConflictException, Injectable } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { GateNaoEstacionadoError } from '../../../domain/gates/gate-nao-estacionado.error';

export const MENSAGEM_GATE_NAO_ESTACIONADO =
  'Este ciclo de gate não está estacionado: não há o que retomar.';

/**
 * O gesto humano que retoma um ciclo de gate ESTACIONADO (ADR 0207, RN-724).
 * Até aqui o único caminho era o `bin/engine rpc` do operador. A api só
 * autoriza (o papel de quem decide a PR, `developer`) e pede ao engine, que
 * é quem sabe se o ciclo está estacionado — recusa vira 409 nomeado.
 */
@Injectable()
export class ResumeParkedGateUseCase {
  constructor(private readonly engineClient: ApiToEngineClient) {}

  async execute(projectId: string, taskId: string, gate: string) {
    try {
      await this.engineClient.resumeParkedGate(projectId, taskId, gate);
    } catch (erro) {
      if (erro instanceof GateNaoEstacionadoError) {
        throw new ConflictException({
          message: MENSAGEM_GATE_NAO_ESTACIONADO,
          reason: 'gate_nao_estacionado',
        });
      }
      throw erro;
    }
    return { ok: true as const };
  }
}
