import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { LLMProviderName } from '@brabo/shared';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';
import { UpsertUserCredentialUseCase } from './upsert-user-credential.use-case';

/**
 * Grava a chave de LLM que o `brabo-runner credentials import` achou na
 * máquina do usuário (AT-611, ADR 0230, RN-927). Delega ao MESMO upsert do
 * cadastro pela tela (envelope com `key_id`, ADR 0158) — nunca uma segunda
 * forma de cifrar. Sem `substituir`, credencial existente é 409 e NADA é
 * tocado. O valor nunca é logado: o log de auditoria leva provider e origem.
 */
@Injectable()
export class ImportRunnerLlmCredentialUseCase {
  private readonly logger = new Logger(ImportRunnerLlmCredentialUseCase.name);

  constructor(
    private readonly credentials: UserCredentialRepository,
    private readonly upsert: UpsertUserCredentialUseCase,
  ) {}

  async execute(
    userId: string,
    provider: LLMProviderName,
    apiKey: string,
    origem: string,
    substituir: boolean,
  ): Promise<{ provider: LLMProviderName; substituida: boolean }> {
    const existentes = await this.credentials.listMetadataForUser(userId);
    const existe = existentes.some((c) => c.provider === provider);
    if (existe && !substituir) {
      throw new ConflictException({
        code: 'credencial_existente',
        message: `Já existe uma credencial de ${provider}; envie substituir: true para trocá-la.`,
      });
    }
    await this.upsert.execute(userId, provider, apiKey);
    this.logger.log(
      `credencial importada pelo runner: provider=${provider} origem=${origem} substituida=${existe}`,
    );
    return { provider, substituida: existe };
  }
}
