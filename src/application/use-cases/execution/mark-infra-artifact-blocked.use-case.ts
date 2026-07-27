import { Injectable } from '@nestjs/common';
import { InfraArtifactRepository } from '../../ports/infra-artifact-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';

/**
 * O InfraAgent (via gate) esgotou o ciclo de correção (Fase 4a) — mirror de
 * MarkTaskBlockedUseCase, mas sem "devolver pra todo" (artefato de infra não
 * tem status de claim): só marca `blocked` com diagnóstico, pro usuário ler
 * na PR/painel.
 */
@Injectable()
export class MarkInfraArtifactBlockedUseCase {
  constructor(
    private readonly infraArtifacts: InfraArtifactRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    artifactId: string,
    reason: string,
    diagnosis: string,
    agentId: string,
  ) {
    const artifact = await this.infraArtifacts.markBlocked(
      artifactId,
      reason,
      diagnosis,
    );
    await this.appendEvent.execute(projectId, sessionId, {
      type: 'infra.artifact_blocked',
      actor: { kind: 'agent', id: agentId },
      payload: { artifactId, reason, diagnosis },
    });
    return artifact;
  }
}
