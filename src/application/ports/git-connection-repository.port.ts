import type { GitConnectionMetadata } from '../../domain/git/git-connection.entity';
import type { GitOauthProviderName } from '../../domain/git/oauth-state';
import type { EncryptedSecret } from './encryption.port';

export interface UpsertGitConnectionInput {
  secret: EncryptedSecret;
  accessTokenExpiresAt: Date | null;
  accountLogin: string | null;
  accountMetadata: Record<string, unknown>;
  connectedBy: string;
}

export abstract class GitConnectionRepository {
  abstract upsert(
    projectId: string,
    provider: GitOauthProviderName,
    input: UpsertGitConnectionInput,
  ): Promise<GitConnectionMetadata>;

  /**
   * Retorna o envelope cifrado bruto — só a camada de aplicação (que
   * decripta imediatamente antes de chamar o provider) pode chamar isto.
   * NUNCA expor o retorno direto num controller.
   */
  abstract findSecretByProjectAndProvider(
    projectId: string,
    provider: GitOauthProviderName,
  ): Promise<EncryptedSecret | null>;

  abstract findMetadataByProjectAndProvider(
    projectId: string,
    provider: GitOauthProviderName,
  ): Promise<GitConnectionMetadata | null>;
}
