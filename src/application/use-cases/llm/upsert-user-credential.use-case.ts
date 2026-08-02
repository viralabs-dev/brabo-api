import { Injectable } from '@nestjs/common';
import type { LLMProviderName } from '@brabo/shared';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';
import { EncryptionService } from '../../ports/encryption.port';
import { LLMCredentialConnectionTester } from '../../ports/llm-credential-connection-tester.port';
import type { UserCredentialMetadata } from '../../../domain/llm/user-credential.entity';

@Injectable()
export class UpsertUserCredentialUseCase {
  constructor(
    private readonly credentials: UserCredentialRepository,
    private readonly encryption: EncryptionService,
    private readonly connectionTester: LLMCredentialConnectionTester,
  ) {}

  async execute(
    userId: string,
    provider: LLMProviderName,
    apiKey: string,
  ): Promise<UserCredentialMetadata> {
    // Testa ANTES de cifrar/persistir — chave inválida nunca chega a gravar
    // nada (mesmo momento do fluxo git, docs/adr/0004). Provider sem teste
    // declarado (hoje: ollama/anthropic/openai) é NO-OP — ver o port.
    await this.connectionTester.test(provider, apiKey);

    const secret = this.encryption.encrypt(apiKey);
    return this.credentials.upsert(userId, provider, secret);
  }
}
