import { Injectable } from '@nestjs/common';
import { RepoBootstrapRepository } from '../../ports/repo-bootstrap-repository.port';
import {
  deriveProvisioningStatus,
  type ProvisioningStatus,
} from '../../../domain/git/repo-bootstrap-status';
import type { BootstrapStepName } from '../../../domain/git/repo-bootstrap.entity';

export interface RepoBootstrapStatus {
  status: ProvisioningStatus | null;
  // Sessão dedicada do bootstrap — a tela de progresso do web puxa os
  // session_events (bootstrap.step_*) dela pra montar o checklist ao vivo.
  sessionId: string | null;
  failedStep: BootstrapStepName | null;
  lastError: string | null;
  attempts: number;
}

@Injectable()
export class GetRepoBootstrapStatusUseCase {
  constructor(private readonly repoBootstraps: RepoBootstrapRepository) {}

  async execute(projectId: string): Promise<RepoBootstrapStatus> {
    const row = await this.repoBootstraps.findByProjectId(projectId);
    return {
      status: deriveProvisioningStatus(row),
      sessionId: row?.sessionId ?? null,
      failedStep: row?.status === 'failed' ? row.step : null,
      lastError: row?.status === 'failed' ? row.lastError : null,
      attempts: row?.attempts ?? 0,
    };
  }
}
