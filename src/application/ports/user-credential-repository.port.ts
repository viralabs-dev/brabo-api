import type { CredentialProviderName } from '@brabo/shared';
import type { UserCredentialMetadata } from '../../domain/llm/user-credential.entity';
import type { EncryptedSecret } from './encryption.port';

export abstract class UserCredentialRepository {
  abstract upsert(
    userId: string,
    provider: CredentialProviderName,
    secret: EncryptedSecret,
  ): Promise<UserCredentialMetadata>;

  /**
   * Retorna o envelope cifrado bruto — só a camada de aplicação (que
   * decripta imediatamente pra montar a chamada ao provider) pode
   * chamar isto. NUNCA expor o retorno direto num controller.
   */
  abstract findSecretByUserAndProvider(
    userId: string,
    provider: CredentialProviderName,
  ): Promise<EncryptedSecret | null>;

  abstract listMetadataForUser(
    userId: string,
  ): Promise<UserCredentialMetadata[]>;
  abstract delete(
    userId: string,
    provider: CredentialProviderName,
  ): Promise<boolean>;
}
