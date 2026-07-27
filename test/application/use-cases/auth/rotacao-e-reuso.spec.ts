import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import { authEvents, refreshTokens } from '../../../../src/db/schema';
import {
  contaPronta,
  montarHarness,
  EMAIL,
  SENHA_BOA,
  type Harness,
} from './harness';

let h: Harness;

beforeAll(async () => {
  h = await montarHarness();
}, 60_000);

beforeEach(async () => {
  await h.limpar();
  h.mail.limpar();
  h.hasher.limpar();
});

afterAll(async () => {
  await h.pool.end();
});

async function eventosDo(kind: string) {
  return h.db.select().from(authEvents).where(eq(authEvents.kind, kind));
}

describe('rotação do refresh', () => {
  it('caminho feliz: cada refresh devolve um par novo', async () => {
    await contaPronta(h);
    const sessao = await h.login.execute({ email: EMAIL, senha: SENHA_BOA });

    const renovada = await h.refresh.execute({
      refreshToken: sessao.refreshToken,
    });

    expect(renovada.refreshToken).not.toBe(sessao.refreshToken);
    expect(renovada.accessToken).toBeTruthy();
  });

  it('o token anterior fica marcado como rotacionado', async () => {
    await contaPronta(h);
    const sessao = await h.login.execute({ email: EMAIL, senha: SENHA_BOA });
    await h.refresh.execute({ refreshToken: sessao.refreshToken });

    const hash = h.tokenFactory.hashDe(sessao.refreshToken);
    const [linha] = await h.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hash));

    expect(linha.rotatedAt).not.toBeNull();
  });

  it('a família e o início são HERDADOS pela cadeia', async () => {
    // Família nova a cada rotação quebraria a detecção de reuso; início novo
    // reiniciaria o teto absoluto e daria sessão eterna. Nenhum dos dois
    // quebraria um teste de caminho feliz.
    await contaPronta(h);
    const s1 = await h.login.execute({ email: EMAIL, senha: SENHA_BOA });
    const s2 = await h.refresh.execute({ refreshToken: s1.refreshToken });
    await h.refresh.execute({ refreshToken: s2.refreshToken });

    const linhas = await h.db.select().from(refreshTokens);
    const familias = new Set(linhas.map((l) => l.familyId));
    const inicios = new Set(linhas.map((l) => l.familyStartedAt.getTime()));

    expect(linhas).toHaveLength(3);
    expect(familias.size).toBe(1);
    expect(inicios.size).toBe(1);
  });

  it('cada login abre uma família própria', async () => {
    await contaPronta(h);
    await h.login.execute({ email: EMAIL, senha: SENHA_BOA });
    await h.login.execute({ email: EMAIL, senha: SENHA_BOA });

    const linhas = await h.db.select().from(refreshTokens);
    expect(new Set(linhas.map((l) => l.familyId)).size).toBe(2);
  });

  it('token desconhecido é recusado', async () => {
    await expect(
      h.refresh.execute({ refreshToken: 'inventado' }),
    ).rejects.toThrow();
  });
});

/**
 * O cenário de roubo do enunciado: dois clientes usando a MESMA família.
 */
describe('reuso: dois clientes na mesma família', () => {
  it('o ladrão reapresenta o token já gasto e a família inteira morre', async () => {
    await contaPronta(h);

    // O legítimo loga e renova. O ladrão ficou com a cópia do token inicial.
    const inicial = await h.login.execute({ email: EMAIL, senha: SENHA_BOA });
    const tokenRoubado = inicial.refreshToken;
    const legitima = await h.refresh.execute({
      refreshToken: inicial.refreshToken,
    });

    // O ladrão usa a cópia. É a assinatura do roubo: token já consumido.
    await expect(
      h.refresh.execute({ refreshToken: tokenRoubado }),
    ).rejects.toThrow();

    // E o legítimo perde o acesso junto — comportamento CORRETO, não bug: do
    // lado do servidor não há como distinguir o legítimo do ladrão, então
    // ambos recomeçam do login.
    await expect(
      h.refresh.execute({ refreshToken: legitima.refreshToken }),
    ).rejects.toThrow();
  });

  it('a revogação atinge todos os tokens vivos da família', async () => {
    await contaPronta(h);
    const inicial = await h.login.execute({ email: EMAIL, senha: SENHA_BOA });
    const roubado = inicial.refreshToken;
    await h.refresh.execute({ refreshToken: inicial.refreshToken });

    await expect(
      h.refresh.execute({ refreshToken: roubado }),
    ).rejects.toThrow();

    const linhas = await h.db.select().from(refreshTokens);
    expect(linhas.every((l) => l.revokedAt !== null)).toBe(true);
    expect(linhas.every((l) => l.revokedReason === 'reuse_detected')).toBe(
      true,
    );
  });

  it('registra o evento de segurança', async () => {
    await contaPronta(h);
    const inicial = await h.login.execute({ email: EMAIL, senha: SENHA_BOA });
    const roubado = inicial.refreshToken;
    await h.refresh.execute({ refreshToken: inicial.refreshToken });
    await expect(
      h.refresh.execute({ refreshToken: roubado }),
    ).rejects.toThrow();

    const eventos = await eventosDo('refresh_reuse_detected');
    expect(eventos).toHaveLength(1);
    expect(eventos[0].metadata).toMatchObject({ revogados: 2 });
  });

  it('a família de OUTRO login não é atingida', async () => {
    // A cascata é escopada à família com evidência. Matar todas as sessões do
    // usuário por um cliente instável derrubaria laptop, celular e tablet
    // juntos, sem que a evidência apontasse para eles.
    await contaPronta(h);
    const alvo = await h.login.execute({ email: EMAIL, senha: SENHA_BOA });
    const outra = await h.login.execute({ email: EMAIL, senha: SENHA_BOA });

    const roubado = alvo.refreshToken;
    await h.refresh.execute({ refreshToken: alvo.refreshToken });
    await expect(
      h.refresh.execute({ refreshToken: roubado }),
    ).rejects.toThrow();

    await expect(
      h.refresh.execute({ refreshToken: outra.refreshToken }),
    ).resolves.toBeTruthy();
  });

  it('a vítima a jusante NÃO dispara uma segunda detecção', async () => {
    // Sem a precedência revogado > reuso, cada aba do usuário legítimo geraria
    // um novo "roubo detectado" e encheria o log de segurança de alarme falso
    // justamente durante o incidente.
    await contaPronta(h);
    const inicial = await h.login.execute({ email: EMAIL, senha: SENHA_BOA });
    const roubado = inicial.refreshToken;
    const legitima = await h.refresh.execute({
      refreshToken: inicial.refreshToken,
    });

    await expect(
      h.refresh.execute({ refreshToken: roubado }),
    ).rejects.toThrow();
    await expect(
      h.refresh.execute({ refreshToken: legitima.refreshToken }),
    ).rejects.toThrow();

    expect(await eventosDo('refresh_reuse_detected')).toHaveLength(1);
    expect(await eventosDo('refresh_revoked')).toHaveLength(1);
  });
});

describe('logout', () => {
  it('revoga a família inteira, não só o token apresentado', async () => {
    await contaPronta(h);
    const sessao = await h.login.execute({ email: EMAIL, senha: SENHA_BOA });
    const renovada = await h.refresh.execute({
      refreshToken: sessao.refreshToken,
    });

    await h.logout.execute({ refreshToken: renovada.refreshToken });

    await expect(
      h.refresh.execute({ refreshToken: renovada.refreshToken }),
    ).rejects.toThrow();
  });

  it('token desconhecido não lança — não é oráculo de validade', async () => {
    await expect(
      h.logout.execute({ refreshToken: 'inventado' }),
    ).resolves.toBeUndefined();
  });
});

describe('trilha de auth', () => {
  it('é append-only: o sucesso não apaga a falha anterior', async () => {
    await contaPronta(h);
    await h.login
      .execute({ email: EMAIL, senha: 'errada mas comprida' })
      .catch(() => {});
    await h.login.execute({ email: EMAIL, senha: SENHA_BOA });

    // O login bem-sucedido limpa o CONTADOR (auth_lockout_hits), nunca a
    // trilha. É por isso que as duas tabelas são separadas.
    expect(await eventosDo('login_failure')).toHaveLength(1);
    expect(await eventosDo('login_success')).toHaveLength(1);
  });

  it('nunca guarda o e-mail em claro no subject_key', async () => {
    await h.login
      .execute({ email: EMAIL, senha: 'errada mas comprida' })
      .catch(() => {});

    const [evento] = await h.db
      .select()
      .from(authEvents)
      .orderBy(desc(authEvents.id))
      .limit(1);

    expect(evento.subjectKey).not.toContain('fulano');
    expect(evento.subjectKey.startsWith('email:')).toBe(true);
  });
});
