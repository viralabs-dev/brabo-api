import type { LLMProviderName } from '@brabo/shared';

/**
 * Projeção segura — nunca contém o segredo (nem cifrado nem plano).
 * É o único formato de credencial que atravessa a fronteira HTTP.
 */
export interface UserCredentialMetadata {
  id: string;
  provider: LLMProviderName;
  createdAt: Date;
  updatedAt: Date;
}
