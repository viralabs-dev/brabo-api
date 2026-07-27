import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../support/test-db';
import { refreshTokens, users } from '../../../src/db/schema';
import { DrizzleRefreshTokenRepository } from '../../../src/infrastructure/persistence/drizzle/refresh-token.repository';
import { DrizzleUnitOfWork } from '../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';

const { db, pool } = createTestDb();
const repo = new DrizzleRefreshTokenRepository(db);
const unitOfWork = new DrizzleUnitOfWork(db);

const TETO = 30 * 24 * 60 * 60 * 1000;
const DAQUI_A_UM_DIA = () => new Date(Date.now() + 86_400_000);

async function criarUsuario(email = 'refresh@brabo.dev') {
  const [linha] = await db.insert(users).values({ email }).returning();
  return linha;
}

async function emitirRaiz(userId: string, hash: string) {
  const familyId = randomUUID();
  const id = await repo.emitir({
    userId,
    familyId,
    tokenHash: hash,
    familyStartedAt: new Date(),
    expiresAt: DAQUI_A_UM_DIA(),
  });
  return { id, familyId };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('DrizzleRefreshTokenRepository', () => {
  it('caminho feliz: emite e classifica como ok', async () => {
    const usuario = await criarUsuario();
    await emitirRaiz(usuario.id, 'hash-a');

    const travado = await unitOfWork.runInTransaction(() =>
      repo.travarEClassificar('hash-a', TETO),
    );

    expect(travado?.classificacao).toBe('ok');
    expect(travado?.userId).toBe(usuario.id);
  });

  it('hash inexistente devolve null', async () => {
    const travado = await unitOfWork.runInTransaction(() =>
      repo.travarEClassificar('não existe', TETO),
    );
    expect(travado).toBeNull();
  });

  it('token rotacionado é classificado como reuso', async () => {
    const usuario = await criarUsuario();
    const { id } = await emitirRaiz(usuario.id, 'hash-a');
    await repo.marcarRotacionado(id);

    const travado = await unitOfWork.runInTransaction(() =>
      repo.travarEClassificar('hash-a', TETO),
    );
    expect(travado?.classificacao).toBe('reuso');
  });

  it('revogarFamilia atinge todos os vivos da família e só dela', async () => {
    const usuario = await criarUsuario();
    const { familyId } = await emitirRaiz(usuario.id, 'hash-a');
    await repo.emitir({
      userId: usuario.id,
      familyId,
      tokenHash: 'hash-b',
      familyStartedAt: new Date(),
      expiresAt: DAQUI_A_UM_DIA(),
    });
    await emitirRaiz(usuario.id, 'hash-de-outra-familia');

    const atingidos = await repo.revogarFamilia(familyId, 'reuse_detected');

    expect(atingidos).toBe(2);
    const outra = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, 'hash-de-outra-familia'));
    expect(outra[0].revokedAt).toBeNull();
  });

  it('revogarFamilia é idempotente — o segundo passe não conta ninguém', async () => {
    const usuario = await criarUsuario();
    const { familyId } = await emitirRaiz(usuario.id, 'hash-a');

    expect(await repo.revogarFamilia(familyId, 'reuse_detected')).toBe(1);
    expect(await repo.revogarFamilia(familyId, 'reuse_detected')).toBe(0);
  });

  it('revogarTodasDoUsuario atinge todas as famílias dele', async () => {
    const usuario = await criarUsuario();
    const outro = await criarUsuario('outro@brabo.dev');
    await emitirRaiz(usuario.id, 'hash-a');
    await emitirRaiz(usuario.id, 'hash-b');
    await emitirRaiz(outro.id, 'hash-c');

    const atingidos = await repo.revogarTodasDoUsuario(
      usuario.id,
      'password_reset',
    );

    expect(atingidos).toBe(2);
    const doOutro = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, 'hash-c'));
    expect(doOutro[0].revokedAt).toBeNull();
  });

  /**
   * O teste que prova o desenho todo.
   *
   * Duas transações reais, abertas ao mesmo tempo, apresentando o MESMO token.
   * Sem o `for update`, as duas leem `rotated_at is null`, as duas rotacionam,
   * a família se bifurca em silêncio e o reuso nunca é detectado — a feature
   * inteira vira no-op exatamente na condição para a qual existe.
   */
  it('duas transações com o mesmo token: uma rotaciona, a outra vê REUSO', async () => {
    const usuario = await criarUsuario();
    await emitirRaiz(usuario.id, 'hash-disputado');

    const classificacoes: string[] = [];
    const liberarSegunda = { resolver: () => {} };
    const segundaPodeComecar = new Promise<void>((r) => {
      liberarSegunda.resolver = r;
    });

    const primeira = unitOfWork.runInTransaction(async () => {
      const travado = await repo.travarEClassificar('hash-disputado', TETO);
      classificacoes.push(`primeira:${travado!.classificacao}`);
      // Só agora a segunda começa — garantindo que ela chega com a linha já
      // travada, que é a corrida que se quer reproduzir.
      liberarSegunda.resolver();
      await repo.marcarRotacionado(travado!.id);
      // Dá tempo de a segunda de fato bloquear no lock antes do commit.
      await new Promise((r) => setTimeout(r, 200));
    });

    const segunda = (async () => {
      await segundaPodeComecar;
      await unitOfWork.runInTransaction(async () => {
        const travado = await repo.travarEClassificar('hash-disputado', TETO);
        classificacoes.push(`segunda:${travado!.classificacao}`);
      });
    })();

    await Promise.all([primeira, segunda]);

    expect(classificacoes).toContain('primeira:ok');
    // A segunda enxerga o estado COMMITADO pelo vencedor, não o snapshot
    // antigo: é o que o `for update` garante ao reavaliar o qualificador
    // depois que o lock é liberado.
    expect(classificacoes).toContain('segunda:reuso');
  });
});
