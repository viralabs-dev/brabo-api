import { Injectable } from '@nestjs/common';
import type { LLMProviderName } from '@brabo/shared';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';
import { EncryptionService } from '../../ports/encryption.port';
import type { UserCredentialMetadata } from '../../../domain/llm/user-credential.entity';

@Injectable()
export class UpsertUserCredentialUseCase {
  constructor(
    private readonly credentials: UserCredentialRepository,
    private readonly encryption: EncryptionService,
  ) {}

  execute(
    userId: string,
    provider: LLMProviderName,
    apiKey: string,
  ): Promise<UserCredentialMetadata> {
    const secret = this.encryption.encrypt(apiKey);
    return this.credentials.upsert(userId, provider, secret);
  }
}
