import { Injectable, NotFoundException } from '@nestjs/common';
import type { CredentialProviderName } from '@brabo/shared';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';
import { EncryptionService } from '../../ports/encryption.port';
import { LLMCredentialConnectionTester } from '../../ports/llm-credential-connection-tester.port';
import { GitCredentialConnectionTester } from '../../ports/git-credential-connection-tester.port';
import { LLMCredentialConnectionTestFailedError } from '../../../domain/llm/llm-credential-errors';
import { GitCredentialConnectionTestFailedError } from '../../../domain/git/git-errors';
import { isGitCredentialProvider } from '../../../domain/git/git-credential-provider-names';

/**
 * Os três desfechos possíveis. `nao_suportado` não é preguiça de modelagem: o
 * tester de LLM é NO-OP para os providers sem endpoint de teste verificado
 * (`ollama`, `anthropic`, `openai`), e num resultado binário eles voltariam
 * como "ok" — a tela afirmaria que a chave foi verificada quando ninguém a
 * verificou.
 */
export type ResultadoDoTeste =
  | { resultado: 'ok' }
  | { resultado: 'recusado'; motivo: string }
  | { resultado: 'nao_suportado' };

/**
 * Verifica uma credencial JÁ gravada (ADR 0050).
 *
 * O segredo é decifrado aqui, usado na chamada ao provider e descartado —
 * nunca atravessa a fronteira HTTP, nem na resposta desta rota. Quem chama
 * recebe status, e no caso de recusa o motivo que o PROVIDER deu, que é o
 * diagnóstico útil ("401 invalid api key" vs. "timeout").
 *
 * Chave ruim não é exceção deste caso de uso: é um resultado. A única
 * exceção é não existir credencial para (usuário, provider) — aí não há o que
 * testar.
 */
@Injectable()
export class TestStoredCredentialUseCase {
  constructor(
    private readonly credentials: UserCredentialRepository,
    private readonly encryption: EncryptionService,
    private readonly llmTester: LLMCredentialConnectionTester,
    private readonly gitTester: GitCredentialConnectionTester,
  ) {}

  async execute(
    userId: string,
    provider: CredentialProviderName,
  ): Promise<ResultadoDoTeste> {
    const secret = await this.credentials.findSecretByUserAndProvider(
      userId,
      provider,
    );
    if (!secret) {
      throw new NotFoundException(
        `nenhuma credencial de ${provider} cadastrada para este usuário`,
      );
    }

    const ehGit = isGitCredentialProvider(provider);
    if (!ehGit && !this.llmTester.supports(provider)) {
      return { resultado: 'nao_suportado' };
    }

    // Decifra o mais tarde possível e não guarda o texto plano em lugar
    // nenhum além do argumento da chamada.
    const plaintext = this.encryption.decrypt(secret);

    try {
      if (ehGit) {
        await this.gitTester.test(provider, plaintext);
      } else {
        await this.llmTester.test(provider, plaintext);
      }
      return { resultado: 'ok' };
    } catch (error) {
      if (
        error instanceof LLMCredentialConnectionTestFailedError ||
        error instanceof GitCredentialConnectionTestFailedError
      ) {
        return { resultado: 'recusado', motivo: error.message };
      }
      throw error;
    }
  }
}
