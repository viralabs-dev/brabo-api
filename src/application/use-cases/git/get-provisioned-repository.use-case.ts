import { Injectable } from '@nestjs/common';
import { ProvisionedRepositoryRepository } from '../../ports/provisioned-repository-repository.port';

@Injectable()
export class GetProvisionedRepositoryUseCase {
  constructor(private readonly repositories: ProvisionedRepositoryRepository) {}

  execute(projectId: string) {
    return this.repositories.findByProjectId(projectId);
  }
}
