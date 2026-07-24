import type { CredentialProviderName } from '@brabo/shared';

/**
 * Projeção segura — nunca contém o segredo (nem cifrado nem plano).
 * É o único formato de credencial que atravessa a fronteira HTTP.
 * `provider` cobre tanto chaves de LLM quanto tokens de git de usuário
 * (github/gitlab) — ver docs/adr/0004-git-credential-registration.md.
 */
export interface UserCredentialMetadata {
  id: string;
  provider: CredentialProviderName;
  createdAt: Date;
  updatedAt: Date;
}
