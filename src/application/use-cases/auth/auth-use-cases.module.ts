import { Module } from '@nestjs/common';
import { AccessTokenIssuer } from '../../ports/access-token-issuer.port';
import { MailSender } from '../../ports/mail-sender.port';
import { PasswordHasher } from '../../ports/password-hasher.port';
import { Argon2PasswordHasher } from '../../../infrastructure/security/argon2-password-hasher';
import { Ed25519AccessTokenIssuer } from '../../../infrastructure/security/ed25519-access-token-issuer';
import { LogMailSender } from '../../../infrastructure/mail/log-mail-sender';
import { SmtpMailSender } from '../../../infrastructure/mail/smtp-mail-sender';
import { resolverModoDeTransporte } from '../../../infrastructure/mail/smtp-config';
import { GitInfrastructureModule } from '../../../infrastructure/git/git-infrastructure.module';
import { EmitirSessaoUseCase } from './emitir-sessao.use-case';
import { LoginUseCase } from './login.use-case';
import { LogoutUseCase } from './logout.use-case';
import { RefreshUseCase } from './refresh.use-case';
import { RegisterUseCase } from './register.use-case';
import { RequestPasswordResetUseCase } from './request-password-reset.use-case';
import { ResetPasswordUseCase } from './reset-password.use-case';
import { SocialLoginCallbackUseCase } from './social-login-callback.use-case';
import { StartSocialLoginUseCase } from './start-social-login.use-case';
import { TokenFactory } from './token-factory';
import { VerifyEmailUseCase } from './verify-email.use-case';
import { IssuePersonalAccessTokenUseCase } from './issue-personal-access-token.use-case';
import { ListPersonalAccessTokensUseCase } from './list-personal-access-tokens.use-case';
import { RevokePersonalAccessTokenUseCase } from './revoke-personal-access-token.use-case';

const USE_CASES = [
  TokenFactory,
  EmitirSessaoUseCase,
  RegisterUseCase,
  LoginUseCase,
  RefreshUseCase,
  LogoutUseCase,
  VerifyEmailUseCase,
  RequestPasswordResetUseCase,
  ResetPasswordUseCase,
  StartSocialLoginUseCase,
  SocialLoginCallbackUseCase,
  IssuePersonalAccessTokenUseCase,
  ListPersonalAccessTokensUseCase,
  RevokePersonalAccessTokenUseCase,
];

/**
 * Casos de uso do auth first-party (Fase 7a).
 *
 * As três implementações de infraestrutura são ligadas aqui, e não num módulo
 * de segurança compartilhado, porque só o auth as usa. Em particular, este
 * módulo NÃO importa o `LlmInfrastructureModule` — que é onde o
 * `EncryptionService` acabou morando — porque hash de senha não é segredo
 * recuperável e não tem nada a ver com envelope encryption. Puxar aquele
 * módulo aqui só para "reaproveitar cripto" seria erro de segurança, não de
 * arquitetura.
 *
 * `GitInfrastructureModule` entrou pelo login social (ADR 0084): é de lá que
 * vem o `GitOauthClientRegistry` — os MESMOS `GithubOauthClient`/
 * `GitlabOauthClient` do fluxo de conexão de git, reusados para autenticação.
 * `SocialIdentityRepository` não precisa de import próprio: é `@Global()` via
 * `DrizzleModule`, como `AuthCredentialRepository`.
 *
 * `MailSender` é `useFactory`, não `useClass` fixo, desde o backlog "SMTP
 * real no MailSender" (ADR 0096): `MAIL_TRANSPORT` decide entre
 * `LogMailSender` (default, inclusive em produção) e `SmtpMailSender`. A
 * validação de `SMTP_*` (RN-114) acontece dentro do construtor de
 * `SmtpMailSender`, exercitada aqui — na montagem do grafo de providers do
 * Nest — e não numa chamada eager em `main.ts`, porque ela só importa quando
 * o operador optou por `smtp`.
 */
@Module({
  imports: [GitInfrastructureModule],
  providers: [
    ...USE_CASES,
    { provide: PasswordHasher, useClass: Argon2PasswordHasher },
    { provide: AccessTokenIssuer, useClass: Ed25519AccessTokenIssuer },
    {
      provide: MailSender,
      useFactory: () =>
        resolverModoDeTransporte() === 'smtp'
          ? new SmtpMailSender()
          : new LogMailSender(),
    },
  ],
  exports: [...USE_CASES, PasswordHasher, AccessTokenIssuer, MailSender],
})
export class AuthUseCasesModule {}
