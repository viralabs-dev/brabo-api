import { Injectable } from '@nestjs/common';
import type { GitProviderContract, GitProviderName } from '@brabo/shared';
import { GitProviderRegistry } from '../../application/ports/git-provider.port';
import { LocalGitProvider } from './local-git-provider';
import { GithubProvider } from './github-provider';
import { GitlabProvider } from './gitlab-provider';

@Injectable()
export class GitProviderRegistryImpl implements GitProviderRegistry {
  constructor(
    private readonly local: LocalGitProvider,
    private readonly github: GithubProvider,
    private readonly gitlab: GitlabProvider,
  ) {}

  get(provider: GitProviderName): GitProviderContract {
    switch (provider) {
      case 'local':
        return this.local;
      case 'github':
        return this.github;
      case 'gitlab':
        return this.gitlab;
    }
  }
}
