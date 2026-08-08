import { Injectable } from '@nestjs/common';
import { GitOauthClientRegistry } from '../../ports/git-oauth-client.port';
import { signOauthState } from '../../../domain/git/oauth-state';
import type { GitOauthProviderName } from '../../../domain/git/oauth-state';
import { resolveOauthStateSecret } from '../../../infrastructure/security/oauth-state-secret';

@Injectable()
export class StartGitOauthUseCase {
  constructor(private readonly gitOauthClients: GitOauthClientRegistry) {}

  execute(
    projectId: string,
    userId: string,
    provider: GitOauthProviderName,
  ): { authorizeUrl: string } {
    const state = signOauthState(
      { projectId, userId, provider },
      resolveOauthStateSecret(),
    );
    const redirectUri = `${apiPublicUrl()}/git/oauth/${provider}/callback`;
    const authorizeUrl = this.gitOauthClients
      .get(provider)
      .buildAuthorizeUrl(state, redirectUri);

    return { authorizeUrl };
  }
}

function apiPublicUrl(): string {
  return process.env.API_PUBLIC_URL ?? 'http://localhost:3000';
}
