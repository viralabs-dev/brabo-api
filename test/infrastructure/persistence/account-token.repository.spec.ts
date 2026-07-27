import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../support/test-db';
import { accountTokens, users } from '../../../src/db/schema';
import { DrizzleAccountTokenRepository } from '../../../src/infrastructure/persistence/drizzle/account-token.repository';

const { db, pool } = createTestDb();
const repo = new DrizzleAccountTokenRepository(db);

const DAQUI_A_UMA_HORA = () => new Date(Date.now() + 3_600_000);
const UMA_HORA_ATRAS = () => new Date(Date.now() - 3_600_000);

async function criarUsuario(email = 'conta@brabo.dev') {
  const [linha] = await db.insert(users).values({ email }).returning();
  return linha;
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('DrizzleAccountTokenRepository', () => {
  it('caminho feliz: emite e consome uma vez', async () => {
    const usuario = await criarUsuario();
    await repo.emitir({
      userId: usuario.id,
      purpose: 'password_reset',
      tokenHash: 'hash-a',
      expiresAt: DAQUI_A_UMA_HORA(),
    });

    const consumido = await repo.consumir({
      tokenHash: 'hash-a',
      purpose: 'password_reset',
    });

    expect(consumido?.userId).toBe(usuario.id);
  });

  it('o segundo consumo do mesmo token devolve null', async () => {
    const usuario = await criarUsuario();
    await repo.emitir({
      userId: usuario.id,
      purpose: 'password_reset',
      tokenHash: 'hash-a',
      expiresAt: DAQUI_A_UMA_HORA(),
    });

    await repo.consumir({ tokenHash: 'hash-a', purpose: 'password_reset' });
    const segundo = await repo.consumir({
      tokenHash: 'hash-a',
      purpose: 'password_reset',
    });

    expect(segundo).toBeNull();
  });

  it('token expirado não é consumido', async () => {
    const usuario = await criarUsuario();
    await db.insert(accountTokens).values({
      userId: usuario.id,
      purpose: 'password_reset',
      tokenHash: 'hash-velho',
      expiresAt: UMA_HORA_ATRAS(),
    });

    expect(
      await repo.consumir({
        tokenHash: 'hash-velho',
        purpose: 'password_reset',
      }),
    ).toBeNull();
  });

  it('token de OUTRO propósito não é consumido', async () => {
    // Cada método do repositório fixa o próprio propósito, então nenhum
    // chamador consegue passar o errado. Este teste trava a condição no SQL.
    const usuario = await criarUsuario();
    await repo.emitir({
      userId: usuario.id,
      purpose: 'email_verification',
      tokenHash: 'hash-a',
      expiresAt: DAQUI_A_UMA_HORA(),
    });

    expect(
      await repo.consumir({ tokenHash: 'hash-a', purpose: 'password_reset' }),
    ).toBeNull();
  });

  it('emitir invalida os vivos do mesmo propósito (supersede)', async () => {
    // Sem isto, cinco cliques em "esqueci minha senha" deixam cinco links de
    // takeover válidos, cada um valendo uma hora.
    const usuario = await criarUsuario();
    for (const hash of ['hash-1', 'hash-2', 'hash-3']) {
      await repo.emitir({
        userId: usuario.id,
        purpose: 'password_reset',
        tokenHash: hash,
        expiresAt: DAQUI_A_UMA_HORA(),
      });
    }

    expect(
      await repo.consumir({ tokenHash: 'hash-1', purpose: 'password_reset' }),
    ).toBeNull();
    expect(
      await repo.consumir({ tokenHash: 'hash-2', purpose: 'password_reset' }),
    ).toBeNull();
    expect(
      await repo.consumir({ tokenHash: 'hash-3', purpose: 'password_reset' }),
    ).not.toBeNull();
  });

  it('o supersede não atinge outro propósito', async () => {
    const usuario = await criarUsuario();
    await repo.emitir({
      userId: usuario.id,
      purpose: 'email_verification',
      tokenHash: 'hash-verificacao',
      expiresAt: DAQUI_A_UMA_HORA(),
    });
    await repo.emitir({
      userId: usuario.id,
      purpose: 'password_reset',
      tokenHash: 'hash-reset',
      expiresAt: DAQUI_A_UMA_HORA(),
    });

    expect(
      await repo.consumir({
        tokenHash: 'hash-verificacao',
        purpose: 'email_verification',
      }),
    ).not.toBeNull();
  });

  it('invalidarVivos marca o motivo e não toca no já consumido', async () => {
    const usuario = await criarUsuario();
    await repo.emitir({
      userId: usuario.id,
      purpose: 'password_reset',
      tokenHash: 'hash-a',
      expiresAt: DAQUI_A_UMA_HORA(),
    });

    const atingidos = await repo.invalidarVivos(
      usuario.id,
      ['password_reset'],
      'password_changed',
    );

    expect(atingidos).toBe(1);
    const [linha] = await db
      .select()
      .from(accountTokens)
      .where(eq(accountTokens.tokenHash, 'hash-a'));
    expect(linha.invalidatedReason).toBe('password_changed');

    // Segundo passe não conta ninguém: já está invalidado.
    expect(
      await repo.invalidarVivos(
        usuario.id,
        ['password_reset'],
        'password_changed',
      ),
    ).toBe(0);
  });

  /**
   * A corrida é o caso NORMAL, não a borda: scanner de segurança de e-mail
   * corporativo (Safe Links, Proofpoint) abre todo link de toda mensagem, e o
   * duplo clique do usuário é rotina. Ler-e-depois-escrever deixaria os dois
   * passarem — e o reset de senha aconteceria duas vezes.
   */
  it('consumos concorrentes: exatamente UM vence', async () => {
    const usuario = await criarUsuario();
    await repo.emitir({
      userId: usuario.id,
      purpose: 'password_reset',
      tokenHash: 'hash-disputado',
      expiresAt: DAQUI_A_UMA_HORA(),
    });

    const resultados = await Promise.all(
      Array.from({ length: 5 }, () =>
        repo.consumir({
          tokenHash: 'hash-disputado',
          purpose: 'password_reset',
        }),
      ),
    );

    expect(resultados.filter((r) => r !== null)).toHaveLength(1);
  });
});
