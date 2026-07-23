import type { GitOauthProviderName } from './oauth-state';

export class GitProviderAuthError extends Error {
  readonly provider: GitOauthProviderName;

  constructor(provider: GitOauthProviderName, message: string) {
    super(message);
    this.name = 'GitProviderAuthError';
    this.provider = provider;
  }
}

export class InvalidOauthStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOauthStateError';
  }
}
