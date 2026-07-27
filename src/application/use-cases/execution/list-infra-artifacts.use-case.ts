import { Injectable } from '@nestjs/common';
import { InfraArtifactRepository } from '../../ports/infra-artifact-repository.port';
import type { InfraArtifact } from '../../../domain/execution/infra-artifact.entity';

/**
 * Lista os artefatos de infra do projeto (Fase 4a) — alimenta a seção "PRs
 * de infra em revisão" da tab Aprovações, mesmo espírito de
 * GetArchitectureUseCase pras ADRs.
 */
@Injectable()
export class ListInfraArtifactsUseCase {
  constructor(private readonly infraArtifacts: InfraArtifactRepository) {}

  execute(projectId: string): Promise<InfraArtifact[]> {
    return this.infraArtifacts.listByProject(projectId);
  }
}
