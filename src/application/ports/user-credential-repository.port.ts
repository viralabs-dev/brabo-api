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

  /**
   * Todos os envelopes cifrados de um provider, de qualquer dono (Fase 9c).
   *
   * O catálogo de modelos é global e o job periódico não roda em nome de
   * ninguém — precisa de UMA chave válida, não da chave de alguém em
   * particular. Devolve mais de uma para o sync poder tentar a próxima quando a
   * primeira foi revogada, em vez de reportar "provider fora do ar" por causa
   * de uma credencial morta.
   *
   * Mesma regra do método acima: só a camada de aplicação chama, e o retorno
   * nunca atravessa a fronteira HTTP.
   */
  abstract listSecretsByProvider(
    provider: CredentialProviderName,
  ): Promise<EncryptedSecret[]>;

  abstract listMetadataForUser(
    userId: string,
  ): Promise<UserCredentialMetadata[]>;
  abstract delete(
    userId: string,
    provider: CredentialProviderName,
  ): Promise<boolean>;
}
