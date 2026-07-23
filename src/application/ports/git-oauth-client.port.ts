import type { GitOauthProviderName } from '../../domain/git/oauth-state';

export interface OauthTokenResult {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  accountLogin: string | null;
  accountMetadata: Record<string, unknown>;
}

export abstract class GitOauthClient {
  abstract readonly provider: GitOauthProviderName;
  abstract buildAuthorizeUrl(state: string, redirectUri: string): string;
  abstract exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<OauthTokenResult>;
}

export abstract class GitOauthClientRegistry {
  abstract get(provider: GitOauthProviderName): GitOauthClient;
}
