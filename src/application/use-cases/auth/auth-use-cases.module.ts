import { Module } from '@nestjs/common';
import { AccessTokenIssuer } from '../../ports/access-token-issuer.port';
import { MailSender } from '../../ports/mail-sender.port';
import { PasswordHasher } from '../../ports/password-hasher.port';
import { Argon2PasswordHasher } from '../../../infrastructure/security/argon2-password-hasher';
import { Ed25519AccessTokenIssuer } from '../../../infrastructure/security/ed25519-access-token-issuer';
import { LogMailSender } from '../../../infrastructure/mail/log-mail-sender';
import { EmitirSessaoUseCase } from './emitir-sessao.use-case';
import { LoginUseCase } from './login.use-case';
import { LogoutUseCase } from './logout.use-case';
import { RefreshUseCase } from './refresh.use-case';
import { RegisterUseCase } from './register.use-case';
import { RequestPasswordResetUseCase } from './request-password-reset.use-case';
import { ResetPasswordUseCase } from './reset-password.use-case';
import { TokenFactory } from './token-factory';
import { VerifyEmailUseCase } from './verify-email.use-case';

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
 */
@Module({
  providers: [
    ...USE_CASES,
    { provide: PasswordHasher, useClass: Argon2PasswordHasher },
    { provide: AccessTokenIssuer, useClass: Ed25519AccessTokenIssuer },
    { provide: MailSender, useClass: LogMailSender },
  ],
  exports: [...USE_CASES, PasswordHasher, AccessTokenIssuer, MailSender],
})
export class AuthUseCasesModule {}
