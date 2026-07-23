import type { GitProviderName } from '@brabo/shared';

export interface CreateRepositoryInput {
  name: string;
  visibility: 'public' | 'private';
  namespace?: string; // org (github) / grupo (gitlab), opcional
  accessToken?: string; // resolvido e pronto — ausente pra 'local'
}

export interface CreateRepositoryResult {
  externalId: string;
  url: string;
  defaultBranch: string;
}

export abstract class GitProvider {
  abstract readonly name: GitProviderName;
  abstract createRepository(
    input: CreateRepositoryInput,
  ): Promise<CreateRepositoryResult>;
}

export abstract class GitProviderRegistry {
  abstract get(provider: GitProviderName): GitProvider;
}
