import type { GitOauthProviderName } from './oauth-state';

/** Nunca inclui o segredo — mesmo princípio de UserCredentialMetadata. */
export interface GitConnectionMetadata {
  id: string;
  projectId: string;
  provider: GitOauthProviderName;
  accountLogin: string | null;
  accountMetadata: Record<string, unknown>;
  accessTokenExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
