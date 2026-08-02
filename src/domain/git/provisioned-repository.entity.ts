import type { GitProviderName } from '@brabo/shared';
import type { RepoOrigin } from './repo-bootstrap.entity';

export interface ProvisionedRepository {
  id: string;
  projectId: string;
  provider: GitProviderName;
  externalId: string;
  url: string;
  defaultBranch: string;
  visibility: 'public' | 'private';
  /** Criado pelo Brabo ou adotado de fora (Fase 12a, RN-046) — imutável. */
  origin: RepoOrigin;
  provisionedBy: string;
  createdAt: Date;
  updatedAt: Date;
}
