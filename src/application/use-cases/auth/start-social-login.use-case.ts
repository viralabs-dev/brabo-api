import { Injectable } from '@nestjs/common';
import { GitOauthClientRegistry } from '../../ports/git-oauth-client.port';
import { signSocialOauthState } from '../../../domain/auth/social-oauth-state';
import type { SocialOauthProviderName } from '../../../domain/auth/social-oauth-state';
import { resolveOauthStateSecret } from '../../../infrastructure/security/oauth-state-secret';

/**
 * Início do login social (RN-272..286, ADR 0084).
 *
 * Não é `StartGitOauthUseCase` com outro nome: aquele exige `projectId` e
 * `userId` de quem JÁ está autenticado — este é o próprio ponto de entrada,
 * sem sessão nenhuma. O `state` nasce com propósito PRÓPRIO
 * (`signSocialOauthState`), nunca o do fluxo de conexão de git.
 */
@Injectable()
export class StartSocialLoginUseCase {
  constructor(private readonly gitOauthClients: GitOauthClientRegistry) {}

  execute(provider: SocialOauthProviderName): { authorizeUrl: string } {
    const state = signSocialOauthState(provider, resolveOauthStateSecret());
    const redirectUri = `${apiPublicUrl()}/auth/oauth/${provider}/callback`;
    const authorizeUrl = this.gitOauthClients
      .get(provider)
      .buildLoginAuthorizeUrl(state, redirectUri);

    return { authorizeUrl };
  }
}

function apiPublicUrl(): string {
  return process.env.API_PUBLIC_URL ?? 'http://localhost:3000';
}
