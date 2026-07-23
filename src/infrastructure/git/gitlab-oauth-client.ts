import { Injectable } from '@nestjs/common';
import {
  GitOauthClient,
  type OauthTokenResult,
} from '../../application/ports/git-oauth-client.port';
import { GitProviderAuthError } from '../../domain/git/git-provider-errors';

interface GitlabAccessTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GitlabUserResponse {
  username: string;
}

@Injectable()
export class GitlabOauthClient implements GitOauthClient {
  readonly provider = 'gitlab' as const;

  buildAuthorizeUrl(state: string, redirectUri: string): string {
    const clientId = process.env.GITLAB_OAUTH_CLIENT_ID ?? '';
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'api',
      state,
    });
    return `https://gitlab.com/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<OauthTokenResult> {
    const response = await fetch('https://gitlab.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITLAB_OAUTH_CLIENT_ID ?? '',
        client_secret: process.env.GITLAB_OAUTH_CLIENT_SECRET ?? '',
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    const data = (await response.json()) as GitlabAccessTokenResponse;
    if (!response.ok || !data.access_token) {
      throw new GitProviderAuthError(
        'gitlab',
        data.error_description ?? 'Falha ao trocar o código OAuth do GitLab',
      );
    }

    const accountLogin = await this.fetchAccountLogin(data.access_token);

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : null,
      accountLogin,
      accountMetadata: {},
    };
  }

  private async fetchAccountLogin(accessToken: string): Promise<string | null> {
    const response = await fetch('https://gitlab.com/api/v4/user', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const user = (await response.json()) as GitlabUserResponse;
    return user.username ?? null;
  }
}
