import { Injectable } from '@nestjs/common';
import type { GitCredentialProviderName } from '@brabo/shared';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';
import { EncryptionService } from '../../ports/encryption.port';
import { GitCredentialConnectionTester } from '../../ports/git-credential-connection-tester.port';
import type { UserCredentialMetadata } from '../../../domain/llm/user-credential.entity';

@Injectable()
export class RegisterGitCredentialUseCase {
  constructor(
    private readonly credentials: UserCredentialRepository,
    private readonly encryption: EncryptionService,
    private readonly connectionTester: GitCredentialConnectionTester,
  ) {}

  async execute(
    userId: string,
    provider: GitCredentialProviderName,
    token: string,
  ): Promise<UserCredentialMetadata> {
    // Testa ANTES de cifrar/persistir — token inválido nunca chega a
    // gravar nada (ver docs/adr/0004-git-credential-registration.md).
    await this.connectionTester.test(provider, token);
    const secret = this.encryption.encrypt(token);
    return this.credentials.upsert(userId, provider, secret);
  }
}
