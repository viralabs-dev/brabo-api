import { Module } from '@nestjs/common';
import { GitInfrastructureModule } from '../../../infrastructure/git/git-infrastructure.module';
import { LlmInfrastructureModule } from '../../../infrastructure/llm/llm-infrastructure.module';
import { LlmUseCasesModule } from '../llm/llm-use-cases.module';
import { SessionsUseCasesModule } from '../sessions/sessions-use-cases.module';
import { StartGitOauthUseCase } from './start-git-oauth.use-case';
import { HandleGitOauthCallbackUseCase } from './handle-git-oauth-callback.use-case';
import { ProvisionRepositoryUseCase } from './provision-repository.use-case';
import { GetProvisionedRepositoryUseCase } from './get-provisioned-repository.use-case';
import { GetRepoBootstrapStatusUseCase } from './get-repo-bootstrap-status.use-case';
import { RegisterGitCredentialUseCase } from './register-git-credential.use-case';
import { BootstrapRunner } from './bootstrap-runner';
import { AdoptRepositoryUseCase } from './adopt-repository.use-case';
import { DecideBootstrapPlanUseCase } from './decide-bootstrap-plan.use-case';
import { GetBootstrapPlanUseCase } from './get-bootstrap-plan.use-case';
import { GetProjectGitRemoteUseCase } from './get-project-git-remote.use-case';
import { AcknowledgeProtectionFailureUseCase } from './acknowledge-protection-failure.use-case';

const USE_CASES = [
  AcknowledgeProtectionFailureUseCase,
  GetProjectGitRemoteUseCase,
  StartGitOauthUseCase,
  HandleGitOauthCallbackUseCase,
  ProvisionRepositoryUseCase,
  AdoptRepositoryUseCase,
  DecideBootstrapPlanUseCase,
  GetBootstrapPlanUseCase,
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
  // LlmUseCasesModule entra pelo `ResolveCredentialOwnerUseCase` (RN-058): o
  // remoto de trabalho usa a credencial do OWNER, e reusar o resolvedor é o
  // que impede duas regras de "de quem é a credencial" divergirem com o tempo.
  // Sem ciclo: `LlmUseCasesModule` só importa a infraestrutura de LLM.
  imports: [
    GitInfrastructureModule,
    LlmInfrastructureModule,
    LlmUseCasesModule,
    SessionsUseCasesModule,
  ],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class GitUseCasesModule {}
