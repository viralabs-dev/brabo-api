import type { GitProviderName } from '@brabo/shared';

export interface ProvisionedRepository {
  id: string;
  projectId: string;
  provider: GitProviderName;
  externalId: string;
  url: string;
  defaultBranch: string;
  visibility: 'public' | 'private';
  provisionedBy: string;
  createdAt: Date;
  updatedAt: Date;
}
