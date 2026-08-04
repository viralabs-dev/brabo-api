import { Injectable } from '@nestjs/common';
import type { GitCredentialProviderName } from '@brabo/shared';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';
import { EncryptionService } from '../../ports/encryption.port';
import type { UserCredentialMetadata } from '../../../domain/llm/user-credential.entity';

/**
 * Cifra e grava o PAT. O teste de conexão que o
 * [ADR 0004](../../../../../docs/adr/0004-git-credential-registration.md)
 * exigia ANTES de persistir saiu daqui pelo ADR 0050 — mesma inversão do lado
 * LLM, pelo mesmo motivo, e de propósito nos dois ao mesmo tempo: token e
 * chave de API são a mesma tabela e a mesma promessa ("write-only, nunca
 * reexibido"), então tratá-los diferente só produziria duas telas com regras
 * distintas para o mesmo objeto.
 *
 * A verificação vive em `TestStoredCredentialUseCase`.
 */
@Injectable()
export class RegisterGitCredentialUseCase {
  constructor(
    private readonly credentials: UserCredentialRepository,
    private readonly encryption: EncryptionService,
  ) {}

  execute(
    userId: string,
    provider: GitCredentialProviderName,
    token: string,
  ): Promise<UserCredentialMetadata> {
    const secret = this.encryption.encrypt(token);
    return this.credentials.upsert(userId, provider, secret);
  }
}
