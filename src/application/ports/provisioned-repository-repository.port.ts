import type { GitProviderName } from '@brabo/shared';
import type { ProvisionedRepository } from '../../domain/git/provisioned-repository.entity';

export interface NewProvisionedRepository {
  projectId: string;
  provider: GitProviderName;
  externalId: string;
  url: string;
  defaultBranch: string;
  visibility: 'public' | 'private';
  provisionedBy: string;
}

export abstract class ProvisionedRepositoryRepository {
  abstract create(
    input: NewProvisionedRepository,
  ): Promise<ProvisionedRepository>;
  abstract findByProjectId(
    projectId: string,
  ): Promise<ProvisionedRepository | null>;
}
