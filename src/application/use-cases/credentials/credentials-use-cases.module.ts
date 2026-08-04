import { Module } from '@nestjs/common';
import { GitInfrastructureModule } from '../../../infrastructure/git/git-infrastructure.module';
import { LlmInfrastructureModule } from '../../../infrastructure/llm/llm-infrastructure.module';
import { TestStoredCredentialUseCase } from './test-stored-credential.use-case';

/**
 * Módulo próprio porque o assunto é próprio: `user_credentials` guarda chave
 * de LLM e token de git na mesma tabela, e verificar uma credencial gravada
 * precisa dos DOIS testers. Pendurar isso no módulo de LLM faria o lado LLM
 * importar a infraestrutura de git só por causa de um caso de uso — e
 * vice-versa, dependendo de onde caísse.
 */
@Module({
  imports: [LlmInfrastructureModule, GitInfrastructureModule],
  providers: [TestStoredCredentialUseCase],
  exports: [TestStoredCredentialUseCase],
})
export class CredentialsUseCasesModule {}
