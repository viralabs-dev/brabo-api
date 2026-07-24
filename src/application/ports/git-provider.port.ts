import type { GitProviderContract, GitProviderName } from '@brabo/shared';

export abstract class GitProviderRegistry {
  abstract get(provider: GitProviderName): GitProviderContract;
}
