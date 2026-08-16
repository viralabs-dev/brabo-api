import { Injectable } from '@nestjs/common';
import {
  GitOauthClient,
  type OauthIdentity,
  type OauthTokenResult,
} from '../../application/ports/git-oauth-client.port';
import { GitProviderAuthError } from '../../domain/git/git-provider-errors';

interface GithubAccessTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GithubUserResponse {
  id: number;
  login: string;
}

interface GithubEmailResponse {
  email: string;
  primary: boolean;
  verified: boolean;
}

@Injectable()
export class GithubOauthClient implements GitOauthClient {
  readonly provider = 'github' as const;

  buildAuthorizeUrl(state: string, redirectUri: string): string {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID ?? '';
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'repo',
      state,
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<OauthTokenResult> {
    const response = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: process.env.GITHUB_OAUTH_CLIENT_ID ?? '',
          client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET ?? '',
          code,
          redirect_uri: redirectUri,
        }),
      },
    );

    const data = (await response.json()) as GithubAccessTokenResponse;
    if (!response.ok || !data.access_token) {
      throw new GitProviderAuthError(
        'github',
        data.error_description ?? 'Falha ao trocar o código OAuth do GitHub',
      );
    }

    const accountLogin = await this.fetchAccountLogin(data.access_token);

    return {
      accessToken: data.access_token,
      refreshToken: null, // OAuth App clássico não emite refresh_token
      expiresAt: null, // token clássico não expira
      accountLogin,
      accountMetadata: {},
    };
  }

  private async fetchAccountLogin(accessToken: string): Promise<string | null> {
    const response = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const user = (await response.json()) as GithubUserResponse;
    return user.login ?? null;
  }

  /**
   * `user:email` a mais que o fluxo de conexão de git nunca pede — login
   * social precisa saber SE o e-mail é verificado, e isso não vem de jeito
   * nenhum sem este escopo.
   */
  buildLoginAuthorizeUrl(state: string, redirectUri: string): string {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID ?? '';
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'read:user user:email',
      state,
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  /**
   * `GET /user` só devolve `email` quando ele é PÚBLICO — e nunca diz se é
   * verificado. A prova de verificação mora exclusivamente em
   * `GET /user/emails`, por isso a segunda chamada: é ela, e não `/user`, que
   * decide `email`/`emailVerified` do resultado. Primário-e-verificado vence;
   * na ausência dele, cai para o primeiro verificado; sem nenhum, o e-mail
   * fica `null` e quem chama decide o que fazer com a lacuna.
   */
  async fetchIdentity(accessToken: string): Promise<OauthIdentity> {
    const userResponse = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userResponse.ok) {
      throw new GitProviderAuthError(
        'github',
        'Falha ao obter o perfil do GitHub',
      );
    }
    const user = (await userResponse.json()) as GithubUserResponse;

    let email: string | null = null;
    let emailVerified = false;
    const emailsResponse = await fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (emailsResponse.ok) {
      const emails = (await emailsResponse.json()) as GithubEmailResponse[];
      const escolhido =
        emails.find((e) => e.primary && e.verified) ??
        emails.find((e) => e.verified) ??
        null;
      if (escolhido) {
        email = escolhido.email;
        emailVerified = escolhido.verified;
      }
    }

    return {
      providerUserId: String(user.id),
      login: user.login ?? null,
      email,
      emailVerified,
    };
  }
}
