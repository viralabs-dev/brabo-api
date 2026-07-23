import { Injectable } from '@nestjs/common';
import { GitOauthClientRegistry } from '../../application/ports/git-oauth-client.port';
import type { GitOauthClient } from '../../application/ports/git-oauth-client.port';
import type { GitOauthProviderName } from '../../domain/git/oauth-state';
import { GithubOauthClient } from './github-oauth-client';
import { GitlabOauthClient } from './gitlab-oauth-client';

@Injectable()
export class GitOauthClientRegistryImpl implements GitOauthClientRegistry {
  constructor(
    private readonly github: GithubOauthClient,
    private readonly gitlab: GitlabOauthClient,
  ) {}

  get(provider: GitOauthProviderName): GitOauthClient {
    switch (provider) {
      case 'github':
        return this.github;
      case 'gitlab':
        return this.gitlab;
    }
  }
}
