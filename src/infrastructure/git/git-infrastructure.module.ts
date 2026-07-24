import { Module } from '@nestjs/common';
import { GitProviderRegistry } from '../../application/ports/git-provider.port';
import { GitOauthClientRegistry } from '../../application/ports/git-oauth-client.port';
import { GitCredentialConnectionTester } from '../../application/ports/git-credential-connection-tester.port';
import { LocalGitProvider } from './local-git-provider';
import { GithubProvider } from './github-provider';
import { GitlabProvider } from './gitlab-provider';
import { GithubOauthClient } from './github-oauth-client';
import { GitlabOauthClient } from './gitlab-oauth-client';
import { GitProviderRegistryImpl } from './git-provider-registry';
import { GitOauthClientRegistryImpl } from './git-oauth-client-registry';
import { GitCredentialConnectionTesterImpl } from './git-credential-connection-tester';

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
    {
      provide: GitCredentialConnectionTester,
      useClass: GitCredentialConnectionTesterImpl,
    },
  ],
  exports: [
    GitProviderRegistry,
    GitOauthClientRegistry,
    GitCredentialConnectionTester,
  ],
})
export class GitInfrastructureModule {}
