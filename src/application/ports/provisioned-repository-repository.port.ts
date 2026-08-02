import type { GitProviderName } from '@brabo/shared';
import type { ProvisionedRepository } from '../../domain/git/provisioned-repository.entity';
import type { RepoOrigin } from '../../domain/git/repo-bootstrap.entity';

export interface NewProvisionedRepository {
  projectId: string;
  provider: GitProviderName;
  externalId: string;
  url: string;
  defaultBranch: string;
  visibility: 'public' | 'private';
  /** Fase 12a: obrigatório na escrita — quem grava sabe se criou ou adotou. */
  origin: RepoOrigin;
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
