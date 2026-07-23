import { Injectable } from '@nestjs/common';
import {
  GitOauthClient,
  type OauthTokenResult,
} from '../../application/ports/git-oauth-client.port';
import { GitProviderAuthError } from '../../domain/git/git-provider-errors';

interface GithubAccessTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GithubUserResponse {
  login: string;
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
}
