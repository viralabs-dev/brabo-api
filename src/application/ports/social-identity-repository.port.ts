import type { SocialOauthProviderName } from '../../domain/auth/social-oauth-state';

export interface SocialIdentity {
  id: string;
  userId: string;
  provider: SocialOauthProviderName;
  providerUserId: string;
  providerEmail: string | null;
  providerLogin: string | null;
  createdAt: Date;
}

/**
 * Vínculo de identidade social (RN-272..286, ADR 0084).
 *
 * `(provider, providerUserId)` é a chave que decide se um retorno de OAuth é
 * um login conhecido — nunca o e-mail, que pode mudar de dono no provider
 * (ver `social-login-callback.use-case.ts`).
 */
export abstract class SocialIdentityRepository {
  abstract findByProviderAccount(
    provider: SocialOauthProviderName,
    providerUserId: string,
  ): Promise<SocialIdentity | null>;

  abstract create(entrada: {
    userId: string;
    provider: SocialOauthProviderName;
    providerUserId: string;
    providerEmail: string | null;
    providerLogin: string | null;
  }): Promise<SocialIdentity>;
}
