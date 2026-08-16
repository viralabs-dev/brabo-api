import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { authCredentials, authEvents, socialIdentities, users } from '../../../../src/db/schema';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { DrizzleUserRepository } from '../../../../src/infrastructure/persistence/drizzle/user.repository';
import { DrizzleAuthCredentialRepository } from '../../../../src/infrastructure/persistence/drizzle/auth-credential.repository';
import { DrizzleAuthEventRepository } from '../../../../src/infrastructure/persistence/drizzle/auth-event.repository';
import { DrizzleRefreshTokenRepository } from '../../../../src/infrastructure/persistence/drizzle/refresh-token.repository';
import { DrizzleSocialIdentityRepository } from '../../../../src/infrastructure/persistence/drizzle/social-identity.repository';
import { Ed25519AccessTokenIssuer } from '../../../../src/infrastructure/security/ed25519-access-token-issuer';
import { TokenFactory } from '../../../../src/application/use-cases/auth/token-factory';
import { EmitirSessaoUseCase } from '../../../../src/application/use-cases/auth/emitir-sessao.use-case';
import { SocialLoginCallbackUseCase } from '../../../../src/application/use-cases/auth/social-login-callback.use-case';
import { StartSocialLoginUseCase } from '../../../../src/application/use-cases/auth/start-social-login.use-case';
import { signSocialOauthState } from '../../../../src/domain/auth/social-oauth-state';
import { InvalidSocialOauthStateError } from '../../../../src/domain/auth/social-oauth-errors';
import type {
  GitOauthClient,
  GitOauthClientRegistry,
  OauthIdentity,
  OauthTokenResult,
} from '../../../../src/application/ports/git-oauth-client.port';

const { db, pool } = createTestDb();

const unitOfWork = new DrizzleUnitOfWork(db);
const usuarios = new DrizzleUserRepository(db);
const credenciais = new DrizzleAuthCredentialRepository(db);
const eventos = new DrizzleAuthEventRepository(db);
const refreshTokens = new DrizzleRefreshTokenRepository(db);
const socialIdentitiesRepo = new DrizzleSocialIdentityRepository(db);
const accessTokens = new Ed25519AccessTokenIssuer();
const tokenFactory = new TokenFactory();
const emitirSessao = new EmitirSessaoUseCase(accessTokens, refreshTokens, tokenFactory);

const SECRET = 'test-social-oauth-secret';

/** Identidade CANNED — cada teste ajusta os campos que precisa. */
function identidade(sobrescrever: Partial<OauthIdentity> = {}): OauthIdentity {
  return {
    providerUserId: 'gh-123',
    login: 'octocat',
    email: 'octocat@brabo.dev',
    emailVerified: true,
    ...sobrescrever,
  };
}

class FakeGithubOauthClient implements GitOauthClient {
  provider = 'github' as const;
  constructor(private readonly identidadeDevolvida: OauthIdentity) {}

  buildAuthorizeUrl = () => 'https://github.com/login/oauth/authorize?fake';
  buildLoginAuthorizeUrl = (state: string) =>
    `https://github.com/login/oauth/authorize?login=1&state=${state}`;

  async exchangeCode(code: string): Promise<OauthTokenResult> {
    await Promise.resolve();
    if (code === 'invalid-code') {
      throw new Error('código rejeitado pelo provider (simulado)');
    }
    return {
      accessToken: 'gh-access-token',
      refreshToken: null,
      expiresAt: null,
      accountLogin: this.identidadeDevolvida.login,
      accountMetadata: {},
    };
  }

  async fetchIdentity(): Promise<OauthIdentity> {
    await Promise.resolve();
    return this.identidadeDevolvida;
  }
}

function registryWith(client: GitOauthClient): GitOauthClientRegistry {
  return { get: () => client };
}

function montarCallback(identidadeDevolvida: OauthIdentity) {
  return new SocialLoginCallbackUseCase(
    unitOfWork,
    registryWith(new FakeGithubOauthClient(identidadeDevolvida)),
    socialIdentitiesRepo,
    credenciais,
    usuarios,
    eventos,
    emitirSessao,
  );
}

const REDIRECT_URI = 'http://localhost:3000/auth/oauth/github/callback';

beforeEach(async () => {
  await truncateAll(db);
  process.env.GIT_OAUTH_STATE_SECRET = SECRET;
});

afterAll(async () => {
  await pool.end();
});

describe('StartSocialLoginUseCase', () => {
  it('caminho feliz: gera state assinado e devolve a URL do provider', () => {
    const useCase = new StartSocialLoginUseCase(
      registryWith(new FakeGithubOauthClient(identidade())),
    );

    const { authorizeUrl } = useCase.execute('github');

    expect(authorizeUrl).toContain('login=1');
    expect(authorizeUrl).toContain('state=');
  });
});

describe('SocialLoginCallbackUseCase', () => {
  it('caminho feliz: provisiona um usuário NOVO, sem senha (RN-278)', async () => {
    const callback = montarCallback(identidade({ email: 'nova@brabo.dev' }));
    const state = signSocialOauthState('github', SECRET);

    const sessao = await callback.execute(
      'github',
      'valid-code',
      state,
      REDIRECT_URI,
    );

    expect(sessao.accessToken).toBeTruthy();

    const [usuario] = await db
      .select()
      .from(users)
      .where(eq(users.email, 'nova@brabo.dev'));
    expect(usuario).toBeTruthy();

    // Sem senha — mesmo estado "pendente" da migração do Keycloak.
    const credencial = await db
      .select()
      .from(authCredentials)
      .where(eq(authCredentials.userId, usuario.id));
    expect(credencial).toHaveLength(0);

    const [vinculo] = await db
      .select()
      .from(socialIdentities)
      .where(eq(socialIdentities.userId, usuario.id));
    expect(vinculo.provider).toBe('github');
    expect(vinculo.providerUserId).toBe('gh-123');

    const [evento] = await db
      .select()
      .from(authEvents)
      .where(eq(authEvents.userId, usuario.id));
    expect(evento.kind).toBe('social_login_new_user');
  });

  it('provisiona conta nova mesmo com e-mail NÃO verificado — não há conta a proteger', async () => {
    const callback = montarCallback(
      identidade({ email: 'sem-verificar@brabo.dev', emailVerified: false }),
    );
    const state = signSocialOauthState('github', SECRET);

    const sessao = await callback.execute(
      'github',
      'valid-code',
      state,
      REDIRECT_URI,
    );

    expect(sessao.accessToken).toBeTruthy();
    const [usuario] = await db
      .select()
      .from(users)
      .where(eq(users.email, 'sem-verificar@brabo.dev'));
    expect(usuario).toBeTruthy();
  });

  it('identidade já conhecida: login direto, sem criar segunda linha', async () => {
    const [usuario] = await db
      .insert(users)
      .values({ email: 'conhecido@brabo.dev' })
      .returning();
    await db.insert(socialIdentities).values({
      userId: usuario.id,
      provider: 'github',
      providerUserId: 'gh-123',
      providerEmail: 'conhecido@brabo.dev',
      providerLogin: 'octocat',
    });

    const callback = montarCallback(identidade({ email: 'conhecido@brabo.dev' }));
    const state = signSocialOauthState('github', SECRET);

    const sessao = await callback.execute(
      'github',
      'valid-code',
      state,
      REDIRECT_URI,
    );

    expect(sessao.accessToken).toBeTruthy();
    const vinculos = await db
      .select()
      .from(socialIdentities)
      .where(eq(socialIdentities.userId, usuario.id));
    expect(vinculos).toHaveLength(1); // não duplicou

    const [novoUsuario] = await db
      .select()
      .from(users)
      .where(eq(users.email, 'conhecido@brabo.dev'));
    expect(await db.select().from(users)).toHaveLength(1);
    expect(novoUsuario.id).toBe(usuario.id);
  });

  it('vincula a conta existente quando o e-mail bate e está VERIFICADO — e marca o e-mail dela como verificado (RN-274/279)', async () => {
    const criado = await credenciais.criarUsuarioComCredencial({
      email: 'jalinar@brabo.dev',
      name: 'Jalinar',
      passwordHash: 'hash-fake',
    });
    // Registrada mas nunca verificou o e-mail por senha.
    expect(criado.credencial!.emailVerifiedAt).toBeNull();

    const callback = montarCallback(
      identidade({ email: 'jalinar@brabo.dev', emailVerified: true }),
    );
    const state = signSocialOauthState('github', SECRET);

    const sessao = await callback.execute(
      'github',
      'valid-code',
      state,
      REDIRECT_URI,
    );

    expect(sessao.accessToken).toBeTruthy();
    const [vinculo] = await db
      .select()
      .from(socialIdentities)
      .where(eq(socialIdentities.userId, criado.userId));
    expect(vinculo).toBeTruthy();

    const credencialDepois = await credenciais.findByUserId(criado.userId);
    expect(credencialDepois!.emailVerifiedAt).not.toBeNull();

    // Nenhuma conta nova nasceu.
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it('RECUSA vincular quando o e-mail bate mas NÃO está verificado pelo provider (RN-274)', async () => {
    const criado = await credenciais.criarUsuarioComCredencial({
      email: 'vitima@brabo.dev',
      name: null,
      passwordHash: 'hash-fake',
    });

    const callback = montarCallback(
      identidade({ email: 'vitima@brabo.dev', emailVerified: false }),
    );
    const state = signSocialOauthState('github', SECRET);

    await expect(
      callback.execute('github', 'valid-code', state, REDIRECT_URI),
    ).rejects.toThrow(ForbiddenException);

    const vinculos = await db
      .select()
      .from(socialIdentities)
      .where(eq(socialIdentities.userId, criado.userId));
    expect(vinculos).toHaveLength(0);
  });

  it('recusa login de identidade vinculada a conta DESABILITADA', async () => {
    const [usuario] = await db
      .insert(users)
      .values({ email: 'banido@brabo.dev' })
      .returning();
    await db.insert(authCredentials).values({
      userId: usuario.id,
      passwordHash: 'hash-fake',
      disabledAt: new Date(),
    });
    await db.insert(socialIdentities).values({
      userId: usuario.id,
      provider: 'github',
      providerUserId: 'gh-123',
      providerEmail: 'banido@brabo.dev',
      providerLogin: 'octocat',
    });

    const callback = montarCallback(identidade({ email: 'banido@brabo.dev' }));
    const state = signSocialOauthState('github', SECRET);

    await expect(
      callback.execute('github', 'valid-code', state, REDIRECT_URI),
    ).rejects.toThrow(ForbiddenException);
  });

  it('recusa provisionar conta nova sem e-mail nenhum do provider', async () => {
    const callback = montarCallback(identidade({ email: null }));
    const state = signSocialOauthState('github', SECRET);

    await expect(
      callback.execute('github', 'valid-code', state, REDIRECT_URI),
    ).rejects.toThrow(BadRequestException);

    expect(await db.select().from(users)).toHaveLength(0);
  });

  it('rejeita state inválido sem tocar o provider nem o banco', async () => {
    const callback = montarCallback(identidade());

    await expect(
      callback.execute('github', 'valid-code', 'state-invalido', REDIRECT_URI),
    ).rejects.toThrow(InvalidSocialOauthStateError);

    expect(await db.select().from(users)).toHaveLength(0);
  });

  it('propaga erro do provider quando o code é rejeitado', async () => {
    const callback = montarCallback(identidade());
    const state = signSocialOauthState('github', SECRET);

    await expect(
      callback.execute('github', 'invalid-code', state, REDIRECT_URI),
    ).rejects.toThrow();

    expect(await db.select().from(users)).toHaveLength(0);
  });
});
