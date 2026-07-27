import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../support/test-db';
import { users } from '../../src/db/schema';
import { JwtAuthGuard } from '../../src/interfaces/http/auth/jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../../src/interfaces/http/auth/public.decorator';
import { IS_SERVICE_ROUTE_KEY } from '../../src/interfaces/http/auth/service-route.decorator';
import { DrizzleUserRepository } from '../../src/infrastructure/persistence/drizzle/user.repository';
import { Ed25519AccessTokenIssuer } from '../../src/infrastructure/security/ed25519-access-token-issuer';
import { FirstPartyTokenVerifier } from '../../src/infrastructure/security/first-party-token-verifier';

/**
 * O salto identidade → `request.user` (Fase 7a — o corte).
 *
 * É o único ponto do sistema que a troca de emissor realmente muda, e não
 * tinha teste nenhum antes. Tudo o que o RBAC faz depois depende do que este
 * guard coloca em `request.user`.
 *
 * ## A regressão que ele existe para pegar
 *
 * Até o corte, o guard fazia UPSERT do usuário a cada requisição, com conflito
 * em `keycloak_sub`. Reaproveitar aquele caminho com o emissor novo — em que o
 * `sub` é o próprio `users.id` — faria a api tentar INSERIR uma linha com o
 * e-mail de uma existente, violando `users_email_lower_idx`. E como esse
 * throw acontece FORA do `try/catch` que envolve só a verificação do token,
 * o sintoma seria 500 em toda requisição autenticada, não 401.
 *
 * Daí a asserção de que nenhuma linha nova aparece em `users`: é ela que
 * distingue "o guard leu" de "o guard sincronizou".
 */
const { db, pool } = createTestDb();

const issuer = new Ed25519AccessTokenIssuer();
const repo = new DrizzleUserRepository(db);
const verifier = new FirstPartyTokenVerifier(issuer);

function contexto(opcoes: { authorization?: string }) {
  const request = {
    headers: opcoes.authorization
      ? { authorization: opcoes.authorization }
      : ({} as Record<string, string>),
  } as { headers: Record<string, string>; user?: unknown };

  const ctx = {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { ctx, request };
}

function guard(marcada?: 'publica' | 'servico'): JwtAuthGuard {
  const reflector = {
    getAllAndOverride: vi.fn((chave: string) => {
      if (chave === IS_PUBLIC_KEY) return marcada === 'publica';
      if (chave === IS_SERVICE_ROUTE_KEY) return marcada === 'servico';
      return undefined;
    }),
  } as unknown as Reflector;

  return new JwtAuthGuard(reflector, verifier, repo);
}

async function criarUsuario(email = 'guard@brabo.dev') {
  const [linha] = await db.insert(users).values({ email }).returning();
  return linha;
}

async function contarUsuarios(): Promise<number> {
  return (await db.select().from(users)).length;
}

beforeAll(() => {
  process.env.AUTH_JWT_SECRET = 'segredo-do-teste-do-guard';
});

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  delete process.env.AUTH_JWT_SECRET;
  await pool.end();
});

describe('JwtAuthGuard', () => {
  it('caminho feliz: popula request.user com a linha persistida', async () => {
    const usuario = await criarUsuario();
    const { token } = await issuer.emitir({
      userId: usuario.id,
      email: usuario.email,
    });
    const { ctx, request } = contexto({ authorization: `Bearer ${token}` });

    await expect(guard().canActivate(ctx)).resolves.toBe(true);

    // O `id` é o contrato: é ele que aparece em project_members.user_id e
    // workspace_members.user_id, e é dele que todo o RBAC depende.
    expect((request.user as { id: string }).id).toBe(usuario.id);
  });

  it('NÃO cria linha em users — o guard lê, não sincroniza', async () => {
    const usuario = await criarUsuario();
    const { token } = await issuer.emitir({
      userId: usuario.id,
      email: usuario.email,
    });

    await guard().canActivate(contexto({ authorization: `Bearer ${token}` }).ctx);

    expect(await contarUsuarios()).toBe(1);
  });

  it('duas requisições seguidas continuam com um usuário só', async () => {
    const usuario = await criarUsuario();
    const { token } = await issuer.emitir({
      userId: usuario.id,
      email: usuario.email,
    });

    for (let i = 0; i < 3; i += 1) {
      await guard().canActivate(
        contexto({ authorization: `Bearer ${token}` }).ctx,
      );
    }

    expect(await contarUsuarios()).toBe(1);
  });

  it('token válido de usuário que não existe mais é 401, não 500', async () => {
    // Sessão órfã: conta apagada com o access token ainda dentro dos 15 min.
    // 401 manda o cliente para o login; 500 vira alerta de infraestrutura por
    // um caso previsto.
    const usuario = await criarUsuario();
    const { token } = await issuer.emitir({
      userId: usuario.id,
      email: usuario.email,
    });
    await truncateAll(db);

    await expect(
      guard().canActivate(contexto({ authorization: `Bearer ${token}` }).ctx),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('token ausente é 401', async () => {
    await expect(guard().canActivate(contexto({}).ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('token malformado é 401', async () => {
    await expect(
      guard().canActivate(contexto({ authorization: 'Bearer nada-disso' }).ctx),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('esquema que não é Bearer é 401', async () => {
    const usuario = await criarUsuario();
    const { token } = await issuer.emitir({
      userId: usuario.id,
      email: usuario.email,
    });

    await expect(
      guard().canActivate(contexto({ authorization: `Basic ${token}` }).ctx),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('token assinado por outra chave é 401', async () => {
    const usuario = await criarUsuario();
    process.env.AUTH_JWT_SECRET = 'outra-chave-completamente';
    const outroIssuer = new Ed25519AccessTokenIssuer();
    const { token } = await outroIssuer.emitir({
      userId: usuario.id,
      email: usuario.email,
    });
    process.env.AUTH_JWT_SECRET = 'segredo-do-teste-do-guard';

    await expect(
      guard().canActivate(contexto({ authorization: `Bearer ${token}` }).ctx),
    ).rejects.toThrow(UnauthorizedException);
  });

  describe('rotas que não exigem usuário', () => {
    it('@Public() passa sem token', async () => {
      await expect(
        guard('publica').canActivate(contexto({}).ctx),
      ).resolves.toBe(true);
    });

    it('@ServiceRoute() passa sem token — quem valida é o EngineServiceGuard', async () => {
      // Sem isto, o corte fecharia as 26 rotas /internal de uma vez: o engine
      // não tem usuário nem JWT para apresentar.
      await expect(
        guard('servico').canActivate(contexto({}).ctx),
      ).resolves.toBe(true);
    });
  });
});
