import { Injectable } from '@nestjs/common';
import type { LLMProviderName } from '@brabo/shared';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';
import { EncryptionService } from '../../ports/encryption.port';
import type { UserCredentialMetadata } from '../../../domain/llm/user-credential.entity';

/**
 * Cifra e grava. Só isso — e é o ponto (ADR 0050).
 *
 * Até a Fase 11a este caso de uso testava a chave contra o provider ANTES de
 * persistir, e recusava o cadastro quando o teste falhava. O modo de falha
 * apareceu em uso real: uma chave recusada virava `422` e NADA era gravado,
 * então o usuário não tinha o que corrigir — nem a chave, que a tela nunca
 * reexibe, nem sinal de qual das duas coisas (chave ou rede) tinha falhado.
 *
 * A verificação não sumiu: virou `TestStoredCredentialUseCase`, ação
 * explícita sobre a credencial JÁ gravada, que decifra no servidor e devolve
 * só o status. Guardar e verificar são dois assuntos.
 */
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
