import { Module } from '@nestjs/common';
import { GitProviderRegistry } from '../../application/ports/git-provider.port';
import { GitOauthClientRegistry } from '../../application/ports/git-oauth-client.port';
import { LocalGitProvider } from './local-git-provider';
import { GithubProvider } from './github-provider';
import { GitlabProvider } from './gitlab-provider';
import { GithubOauthClient } from './github-oauth-client';
import { GitlabOauthClient } from './gitlab-oauth-client';
import { GitProviderRegistryImpl } from './git-provider-registry';
import { GitOauthClientRegistryImpl } from './git-oauth-client-registry';

@Module({
  providers: [
    LocalGitProvider,
    GithubProvider,
    GitlabProvider,
    GithubOauthClient,
    GitlabOauthClient,
    { provide: GitProviderRegistry, useClass: GitProviderRegistryImpl },
    {
      provide: GitOauthClientRegistry,
      useClass: GitOauthClientRegistryImpl,
    },
  ],
  exports: [GitProviderRegistry, GitOauthClientRegistry],
})
export class GitInfrastructureModule {}
