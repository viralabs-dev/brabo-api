import { createTestDb, truncateAll } from '../../../support/test-db';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { DrizzleUserRepository } from '../../../../src/infrastructure/persistence/drizzle/user.repository';
import { DrizzleAuthCredentialRepository } from '../../../../src/infrastructure/persistence/drizzle/auth-credential.repository';
import { DrizzleRefreshTokenRepository } from '../../../../src/infrastructure/persistence/drizzle/refresh-token.repository';
import { DrizzleAccountTokenRepository } from '../../../../src/infrastructure/persistence/drizzle/account-token.repository';
import { DrizzleAuthEventRepository } from '../../../../src/infrastructure/persistence/drizzle/auth-event.repository';
import { DrizzleLoginThrottle } from '../../../../src/infrastructure/persistence/drizzle/drizzle-login-throttle';
import { Argon2PasswordHasher } from '../../../../src/infrastructure/security/argon2-password-hasher';
import { Ed25519AccessTokenIssuer } from '../../../../src/infrastructure/security/ed25519-access-token-issuer';
import type {
  EmailParaEnviar,
  MailSender,
} from '../../../../src/application/ports/mail-sender.port';
import type { PasswordHasher } from '../../../../src/application/ports/password-hasher.port';
import { TokenFactory } from '../../../../src/application/use-cases/auth/token-factory';
import { EmitirSessaoUseCase } from '../../../../src/application/use-cases/auth/emitir-sessao.use-case';
import { LoginUseCase } from '../../../../src/application/use-cases/auth/login.use-case';
import { LogoutUseCase } from '../../../../src/application/use-cases/auth/logout.use-case';
import { RefreshUseCase } from '../../../../src/application/use-cases/auth/refresh.use-case';
import { RegisterUseCase } from '../../../../src/application/use-cases/auth/register.use-case';
import { RequestPasswordResetUseCase } from '../../../../src/application/use-cases/auth/request-password-reset.use-case';
import { ResetPasswordUseCase } from '../../../../src/application/use-cases/auth/reset-password.use-case';
import { VerifyEmailUseCase } from '../../../../src/application/use-cases/auth/verify-email.use-case';

/**
 * Monta os casos de uso à mão, com repositórios Drizzle REAIS contra o
 * `brabo_test` — o estilo já usado em `append-session-event.use-case.spec.ts`.
 *
 * O banco não é mockado de propósito: metade do que estes testes precisam
 * provar (o `for update` da rotação, o consumo atômico do token, a janela
 * deslizante) É comportamento do Postgres. Com banco falso o teste afirmaria
 * sobre o dublê, não sobre o sistema.
 */

/** Captura os e-mails em vez de logar — é assim que o teste pega o token. */
export class MailSenderDeTeste implements MailSender {
  readonly enviados: EmailParaEnviar[] = [];

  enviar(email: EmailParaEnviar): Promise<void> {
    this.enviados.push(email);
    return Promise.resolve();
  }

  ultimoDoTipo(tipo: EmailParaEnviar['tipo']): EmailParaEnviar | undefined {
    return [...this.enviados].reverse().find((e) => e.tipo === tipo);
  }

  limpar(): void {
    this.enviados.length = 0;
  }
}

/**
 * Espião sobre o hasher real.
 *
 * Conta as chamadas de `verify` e guarda os hashes que recebeu. É o que torna
 * o teste de enumeração DETERMINÍSTICO: em vez de cronometrar, ele afirma que
 * os três ramos passaram pelo mesmo trabalho, com os mesmos parâmetros.
 */
export class HasherEspiao implements PasswordHasher {
  readonly verifies: string[] = [];
  readonly hashes: string[] = [];

  constructor(private readonly real: Argon2PasswordHasher) {}

  get dummyHash(): string {
    return this.real.dummyHash;
  }

  get params() {
    return this.real.params;
  }

  async hash(plaintext: string): Promise<string> {
    const resultado = await this.real.hash(plaintext);
    this.hashes.push(resultado);
    return resultado;
  }

  verify(encoded: string, plaintext: string): Promise<boolean> {
    this.verifies.push(encoded);
    return this.real.verify(encoded, plaintext);
  }

  limpar(): void {
    this.verifies.length = 0;
    this.hashes.length = 0;
  }
}

export async function montarHarness() {
  const { db, pool } = createTestDb();

  const unitOfWork = new DrizzleUnitOfWork(db);
  const usuarios = new DrizzleUserRepository(db);
  const credenciais = new DrizzleAuthCredentialRepository(db);
  const refreshTokens = new DrizzleRefreshTokenRepository(db);
  const tokensDeConta = new DrizzleAccountTokenRepository(db);
  const eventos = new DrizzleAuthEventRepository(db);
  const throttle = new DrizzleLoginThrottle(db);

  const hasherReal = new Argon2PasswordHasher();
  await hasherReal.onModuleInit();
  const hasher = new HasherEspiao(hasherReal);

  const accessTokens = new Ed25519AccessTokenIssuer();
  const tokenFactory = new TokenFactory();
  const mail = new MailSenderDeTeste();

  const emitirSessao = new EmitirSessaoUseCase(
    accessTokens,
    refreshTokens,
    tokenFactory,
  );

  return {
    db,
    pool,
    mail,
    hasher,
    throttle,
    eventos,
    accessTokens,
    tokenFactory,
    refreshTokens,
    credenciais,
    tokensDeConta,
    limpar: () => truncateAll(db),
    register: new RegisterUseCase(
      unitOfWork,
      credenciais,
      tokensDeConta,
      hasher,
      mail,
      eventos,
      tokenFactory,
    ),
    login: new LoginUseCase(
      credenciais,
      hasher,
      throttle,
      eventos,
      emitirSessao,
      tokensDeConta,
      mail,
      tokenFactory,
    ),
    refresh: new RefreshUseCase(
      unitOfWork,
      refreshTokens,
      credenciais,
      usuarios,
      eventos,
      emitirSessao,
      tokenFactory,
    ),
    logout: new LogoutUseCase(unitOfWork, refreshTokens, eventos, tokenFactory),
    verifyEmail: new VerifyEmailUseCase(
      unitOfWork,
      tokensDeConta,
      credenciais,
      eventos,
      tokenFactory,
    ),
    requestReset: new RequestPasswordResetUseCase(
      credenciais,
      tokensDeConta,
      throttle,
      mail,
      eventos,
      tokenFactory,
    ),
    resetPassword: new ResetPasswordUseCase(
      unitOfWork,
      tokensDeConta,
      credenciais,
      refreshTokens,
      usuarios,
      hasher,
      throttle,
      eventos,
      tokenFactory,
    ),
  };
}

export type Harness = Awaited<ReturnType<typeof montarHarness>>;

export const SENHA_BOA = 'cavalo bateria grampo correto';
export const EMAIL = 'fulano@brabo.dev';

/** Registra e já verifica o e-mail — o estado de onde a maioria dos testes parte. */
export async function contaPronta(
  h: Harness,
  email = EMAIL,
  senha = SENHA_BOA,
): Promise<void> {
  await h.register.execute({ email, senha });
  const verificacao = h.mail.ultimoDoTipo('email_verification');
  await h.verifyEmail.execute({ token: verificacao!.token! });
  h.mail.limpar();
  h.hasher.limpar();
}
