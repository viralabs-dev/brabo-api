import { Injectable } from '@nestjs/common';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import {
  EVENTO_REDE_DO_CONTAINER,
  RedeInvalidaError,
  validarRedeDoContainer,
  versaoDoPayload,
  type RedeDoContainer,
} from '../../../domain/containers/rede-do-container';

export interface RedeVigente extends RedeDoContainer {
  version: number;
}

/**
 * O `artifact.container_network` vigente (AT-608, RN-931): o de maior
 * `version`, desempate por `seq`. `null` sem declaração; payload que não valida
 * mais é ignorado (nunca se passa ao broker o que a régua recusa).
 */
@Injectable()
export class ObterRedeDoContainerUseCase {
  constructor(private readonly eventos: SessionEventRepository) {}

  async execute(projectId: string): Promise<RedeVigente | null> {
    const eventos = await this.eventos.listByTypeForProject(
      projectId,
      EVENTO_REDE_DO_CONTAINER,
    );
    let vigente: (typeof eventos)[number] | null = null;
    for (const e of eventos) {
      if (!vigente) {
        vigente = e;
        continue;
      }
      const a = versaoDoPayload(e.payload);
      const b = versaoDoPayload(vigente.payload);
      if (a > b || (a === b && e.seq > vigente.seq)) vigente = e;
    }
    if (!vigente) return null;
    try {
      return {
        ...validarRedeDoContainer(vigente.payload),
        version: versaoDoPayload(vigente.payload),
      };
    } catch (e) {
      if (e instanceof RedeInvalidaError) return null;
      throw e;
    }
  }
}
