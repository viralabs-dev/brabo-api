import { Module } from '@nestjs/common';
import { GitInfrastructureModule } from '../../../infrastructure/git/git-infrastructure.module';
import { LlmInfrastructureModule } from '../../../infrastructure/llm/llm-infrastructure.module';
import { SessionsUseCasesModule } from '../sessions/sessions-use-cases.module';
import { StartGitOauthUseCase } from './start-git-oauth.use-case';
import { HandleGitOauthCallbackUseCase } from './handle-git-oauth-callback.use-case';
import { ProvisionRepositoryUseCase } from './provision-repository.use-case';
import { GetProvisionedRepositoryUseCase } from './get-provisioned-repository.use-case';
import { GetRepoBootstrapStatusUseCase } from './get-repo-bootstrap-status.use-case';
import { RegisterGitCredentialUseCase } from './register-git-credential.use-case';
import { BootstrapRunner } from './bootstrap-runner';
import { AdoptRepositoryUseCase } from './adopt-repository.use-case';

const USE_CASES = [
  StartGitOauthUseCase,
  HandleGitOauthCallbackUseCase,
  ProvisionRepositoryUseCase,
  AdoptRepositoryUseCase,
  GetProvisionedRepositoryUseCase,
  GetRepoBootstrapStatusUseCase,
  RegisterGitCredentialUseCase,
  // Colaborador, não caso de uso: o executor do bootstrap, extraído na
  // Fase 12a pra ser compartilhado com a adoção sem que ela precise
  // depender do provisionamento inteiro.
  BootstrapRunner,
];

@Module({
  // LlmInfrastructureModule é importado só pelo EncryptionService já
  // exportado de lá (reaproveitado tal como está, sem port novo de
  // criptografia) — mesmo padrão de acoplamento que já existe hoje.
  // SessionsUseCasesModule é o que dá ProvisionRepositoryUseCase acesso a
  // AppendSessionEventUseCase/TransitionSessionUseCase, pro bootstrap
  // narrar sua história na sessão dedicada (ver docs/adr/0005).
  imports: [
    GitInfrastructureModule,
    LlmInfrastructureModule,
    SessionsUseCasesModule,
  ],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class GitUseCasesModule {}
