import { Injectable } from '@nestjs/common';
import { RepoBootstrapRepository } from '../../ports/repo-bootstrap-repository.port';
import {
  deriveProvisioningStatus,
  type ProvisioningStatus,
} from '../../../domain/git/repo-bootstrap-status';
import type { BootstrapStepName } from '../../../domain/git/repo-bootstrap.entity';

export interface RepoBootstrapStatus {
  status: ProvisioningStatus | null;
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
      failedStep: row?.status === 'failed' ? row.step : null,
      lastError: row?.status === 'failed' ? row.lastError : null,
      attempts: row?.attempts ?? 0,
    };
  }
}
