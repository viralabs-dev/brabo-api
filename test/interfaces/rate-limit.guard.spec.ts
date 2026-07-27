import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { RateLimitGuard } from '../../src/interfaces/http/shared/rate-limit.guard';
import { createTestDb } from '../support/test-db';
import { IS_PUBLIC_KEY } from '../../src/interfaces/http/auth/public.decorator';
import { IS_SERVICE_ROUTE_KEY } from '../../src/interfaces/http/auth/service-route.decorator';

/**
 * Rate limit com janela deslizante no Postgres (Fase 5, item 7).
 *
 * Roda contra o banco de verdade de propósito: o coração desta implementação é
 * um CTE que faz INSERT e COUNT no mesmo statement, e com o banco mockado o
 * teste passaria a afirmar sobre o mock em vez de sobre a consulta.
 */
const { db, pool } = createTestDb();

function contexto(opcoes: {
  userId?: string;
  ip?: string;
}): { ctx: ExecutionContext; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const request = {
    user: opcoes.userId ? { id: opcoes.userId } : undefined,
    ip: opcoes.ip ?? '10.0.0.1',
    headers: {} as Record<string, string | string[] | undefined>,
    socket: { remoteAddress: opcoes.ip ?? '10.0.0.1' },
  };
  const response = {
    setHeader: (nome: string, valor: string) => {
      headers[nome] = valor;
    },
  };

  const ctx = {
    getType: () => 'http',
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;

  return { ctx, headers };
}

/**
 * O reflector responde por CHAVE, não com um valor único.
 *
 * Desde a Fase 7a o guard consulta dois metadados — `@Public()` e
 * `@ServiceRoute()` — e um mock que devolvesse o mesmo para os dois não
 * conseguiria distinguir "rota pública" de "rota de serviço", que é
 * exatamente o que estes testes precisam separar.
 */
function guard(marcada?: 'publica' | 'servico'): RateLimitGuard {
  const reflector = {
    getAllAndOverride: vi.fn((chave: string) => {
      if (chave === IS_PUBLIC_KEY) return marcada === 'publica';
      if (chave === IS_SERVICE_ROUTE_KEY) return marcada === 'servico';
      return undefined;
    }),
  } as unknown as Reflector;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new RateLimitGuard(reflector, db as any);
}

describe('RateLimitGuard', () => {
  beforeEach(async () => {
    await db.execute(sql`truncate table rate_limit_hits restart identity`);
    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_USER = '3';
    process.env.RATE_LIMIT_IP = '1000';
  });

  afterAll(async () => {
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.RATE_LIMIT_WINDOW_MS;
    delete process.env.RATE_LIMIT_USER;
    delete process.env.RATE_LIMIT_IP;
    await pool.end();
  });

  it('caminho feliz: deixa passar dentro do limite e anuncia o que resta', async () => {
    const g = guard();
    const { ctx, headers } = contexto({ userId: 'u-1' });

    await expect(g.canActivate(ctx)).resolves.toBe(true);
    expect(headers['X-RateLimit-Limit']).toBe('3');
    expect(headers['X-RateLimit-Remaining']).toBe('2');
  });

  it('barra com 429 ao ultrapassar o limite do usuário', async () => {
    const g = guard();

    for (let i = 0; i < 3; i += 1) {
      await expect(g.canActivate(contexto({ userId: 'u-2' }).ctx)).resolves.toBe(
        true,
      );
    }

    // A quarta estoura.
    await expect(g.canActivate(contexto({ userId: 'u-2' }).ctx)).rejects.toThrow(
      HttpException,
    );
  });

  it('os baldes são independentes: um usuário estourado não afeta o outro', async () => {
    const g = guard();
    for (let i = 0; i < 4; i += 1) {
      await g.canActivate(contexto({ userId: 'u-3' }).ctx).catch(() => undefined);
    }
    await expect(g.canActivate(contexto({ userId: 'u-4' }).ctx)).resolves.toBe(
      true,
    );
  });

  it('só conta dentro da janela — hit antigo não pesa', async () => {
    const g = guard();
    // Três hits de duas horas atrás: fora da janela de 60 s.
    await db.execute(sql`
      insert into rate_limit_hits (bucket_key, occurred_at)
      select 'user:u-5', now() - interval '2 hours' from generate_series(1, 3)
    `);
    await expect(g.canActivate(contexto({ userId: 'u-5' }).ctx)).resolves.toBe(
      true,
    );
  });

  it('rota @ServiceRoute() não é limitada — senão o sistema se auto-estrangula', async () => {
    // A isenção do engine vinha do `clientId` (o `azp` do Keycloak) até a Fase
    // 7a. Sem emissor externo não há claim de client, e este guard roda ANTES
    // do EngineServiceGuard — o metadado da rota é o único sinal disponível a
    // tempo.
    const g = guard('servico');
    for (let i = 0; i < 10; i += 1) {
      await expect(
        g.canActivate(contexto({ userId: 'u-6' }).ctx),
      ).resolves.toBe(true);
    }
    const [linha] = await db
      .execute<{ total: number }>(
        sql`select count(*)::int as total from rate_limit_hits where bucket_key = 'user:u-6'`,
      )
      .then((r) => (r as unknown as { rows: { total: number }[] }).rows);
    // Nem chegou a registrar: rota isenta não custa INSERT.
    expect(linha.total).toBe(0);
  });

  it('rota @Public() não é limitada — estrangular /health reinicia o pod', async () => {
    const g = guard('publica');
    for (let i = 0; i < 10; i += 1) {
      await expect(g.canActivate(contexto({ userId: 'u-7' }).ctx)).resolves.toBe(
        true,
      );
    }
  });

  it('desligado por env, não toca no banco', async () => {
    process.env.RATE_LIMIT_ENABLED = 'false';
    const g = guard();
    await expect(g.canActivate(contexto({ userId: 'u-8' }).ctx)).resolves.toBe(
      true,
    );
    const [linha] = await db
      .execute<{ total: number }>(
        sql`select count(*)::int as total from rate_limit_hits`,
      )
      .then((r) => (r as unknown as { rows: { total: number }[] }).rows);
    expect(linha.total).toBe(0);
  });

  it('falha do banco LIBERA a requisição em vez de negar', async () => {
    // Este guard protege contra abuso, não contra acesso indevido — quem
    // autoriza é o JwtAuthGuard, que já rodou. Diante de um problema nosso,
    // servir demais é melhor do que derrubar a api inteira.
    const quebrado = {
      execute: () => Promise.reject(new Error('conexão recusada')),
    };
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(false),
    } as unknown as Reflector;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = new RateLimitGuard(reflector, quebrado as any);

    await expect(g.canActivate(contexto({ userId: 'u-9' }).ctx)).resolves.toBe(
      true,
    );
  });
});
