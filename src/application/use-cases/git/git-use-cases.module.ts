import { Module } from '@nestjs/common';
import { GitInfrastructureModule } from '../../../infrastructure/git/git-infrastructure.module';
import { LlmInfrastructureModule } from '../../../infrastructure/llm/llm-infrastructure.module';
import { StartGitOauthUseCase } from './start-git-oauth.use-case';
import { HandleGitOauthCallbackUseCase } from './handle-git-oauth-callback.use-case';
import { ProvisionRepositoryUseCase } from './provision-repository.use-case';
import { GetProvisionedRepositoryUseCase } from './get-provisioned-repository.use-case';

const USE_CASES = [
  StartGitOauthUseCase,
  HandleGitOauthCallbackUseCase,
  ProvisionRepositoryUseCase,
  GetProvisionedRepositoryUseCase,
];

@Module({
  // LlmInfrastructureModule é importado só pelo EncryptionService já
  // exportado de lá (reaproveitado tal como está, sem port novo de
  // criptografia) — mesmo padrão de acoplamento que já existe hoje.
  imports: [GitInfrastructureModule, LlmInfrastructureModule],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class GitUseCasesModule {}
