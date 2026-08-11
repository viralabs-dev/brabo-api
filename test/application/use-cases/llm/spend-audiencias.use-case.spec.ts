import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  models,
  projects,
  sessions,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleTokenUsageRepository } from '../../../../src/infrastructure/persistence/drizzle/token-usage.repository';
import { DrizzleWorkspaceRepository } from '../../../../src/infrastructure/persistence/drizzle/workspace.repository';
import { GetWorkspaceSpendReportUseCase } from '../../../../src/application/use-cases/llm/get-workspace-spend-report.use-case';
import { GetMySpendUseCase } from '../../../../src/application/use-cases/llm/get-my-spend.use-case';

const { db, pool } = createTestDb();
const tokenUsageRepo = new DrizzleTokenUsageRepository(db);
const relatorioDoOwner = new GetWorkspaceSpendReportUseCase(
  tokenUsageRepo,
  new DrizzleWorkspaceRepository(db),
);
const meuConsumo = new GetMySpendUseCase(tokenUsageRepo);

/**
 * As duas audiências do mesmo gasto (FASE 22, ADR 0063, RN-101).
 *
 * A colisão que estes testes fixam: a chave que roda é a do OWNER (RN-058) e a
 * fatura dela é dele e só dele (RN-060). O membro não pode ver a conta — mas
 * pode ver o que ELE consumiu. As duas leituras saem da mesma tabela e nunca
 * respondem a mesma pergunta.
 */
async function setup() {
  const [dono] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-dono-spend', email: 'dono-spend@brabo.dev' })
    .returning();
  const [membro] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-membro-spend', email: 'membro-spend@brabo.dev' })
    .returning();
  const [outro] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-outro-spend', email: 'outro-spend@brabo.dev' })
    .returning();

  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'Acme', slug: 'acme-spend', createdBy: dono.id })
    .returning();

  const [loja] = await db
    .insert(projects)
    .values({
      workspaceId: ws.id,
      name: 'Loja',
      slug: 'loja-spend',
      createdBy: dono.id,
    })
    .returning();
  const [portal] = await db
    .insert(projects)
    .values({
      workspaceId: ws.id,
      name: 'Portal',
      slug: 'portal-spend',
      createdBy: dono.id,
    })
    .returning();

  const [sessaoA] = await db
    .insert(sessions)
    .values({ projectId: loja.id, createdBy: membro.id })
    .returning();
  const [sessaoB] = await db
    .insert(sessions)
    .values({ projectId: loja.id, createdBy: membro.id })
    .returning();
  const [sessaoPortal] = await db
    .insert(sessions)
    .values({ projectId: portal.id, createdBy: dono.id })
    .returning();

  const [modelo] = await db
    .insert(models)
    .values({ provider: 'openrouter', name: 'algum/modelo', displayName: 'M' })
    .returning();

  return {
    dono,
    membro,
    outro,
    ws,
    loja,
    portal,
    sessaoA,
    sessaoB,
    sessaoPortal,
    modelo,
  };
}

async function gasto(input: {
  sessionId: string;
  modelId: string;
  provider?: 'openrouter' | 'openai';
  modelName?: string;
  actorKind: 'agent' | 'user';
  actorId: string;
  costMicros: number;
}) {
  await tokenUsageRepo.record({
    sessionId: input.sessionId,
    actor: { kind: input.actorKind, id: input.actorId },
    provider: input.provider ?? 'openrouter',
    modelId: input.modelId,
    modelName: input.modelName ?? 'algum/modelo',
    inputTokens: 10,
    outputTokens: 5,
    estimated: false,
    costMicros: input.costMicros,
    latencyMs: 100,
    inputPricePerMillionMicros: 0,
    outputPricePerMillionMicros: 0,
    bindingOrigin: null,
    upstreamProvider: null,
  });
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('GetWorkspaceSpendReportUseCase — a audiência do owner', () => {
  it('quebra por modelo, por projeto e por ator, com o mesmo total nos três', async () => {
    const { ws, loja, portal, sessaoA, sessaoPortal, modelo, dono, membro } =
      await setup();

    await gasto({
      sessionId: sessaoA.id,
      modelId: modelo.id,
      modelName: 'caro/modelo',
      actorKind: 'agent',
      actorId: 'criativo',
      costMicros: 1_000,
    });
    await gasto({
      sessionId: sessaoA.id,
      modelId: modelo.id,
      modelName: 'barato/modelo',
      actorKind: 'user',
      actorId: membro.id,
      costMicros: 300,
    });
    await gasto({
      sessionId: sessaoPortal.id,
      modelId: modelo.id,
      modelName: 'caro/modelo',
      actorKind: 'user',
      actorId: dono.id,
      costMicros: 200,
    });

    const relatorio = await relatorioDoOwner.execute(ws.id, 30);

    expect(relatorio.ownerId).toBe(dono.id);
    expect(relatorio.totalMicros).toBe(1_500);

    // Por MODELO — a agregação que não existia. Duas linhas, a mais cara antes.
    expect(
      relatorio.porModelo.map((l) => [l.chave, l.costMicros]),
    ).toEqual([
      ['caro/modelo', 1_200],
      ['barato/modelo', 300],
    ]);

    // Por PROJETO dentro do workspace — o join que a FK não dá de graça.
    expect(
      relatorio.porProjeto.map((l) => [l.rotulo, l.costMicros]),
    ).toEqual([
      ['Loja', 1_300],
      ['Portal', 200],
    ]);
    expect(relatorio.porProjeto.map((l) => l.chave)).toEqual([loja.id, portal.id]);

    // Por ATOR — agente e pessoa na mesma lista, distintos por `actorKind`.
    const porAtor = Object.fromEntries(
      relatorio.porAtor.map((l) => [l.chave, l]),
    );
    expect(porAtor['criativo'].actorKind).toBe('agent');
    expect(porAtor[membro.id].actorKind).toBe('user');
    expect(porAtor[dono.id].costMicros).toBe(200);
  });

  /**
   * A ausência do eixo é a regra, não esquecimento: quebrar gasto por provider
   * é quebrar por CREDENCIAL, e essa resposta é `credential-spend`, exclusiva
   * do owner pela RN-060. Duas chamadas em providers diferentes servindo o
   * MESMO nome de modelo caem numa linha só.
   */
  it('não tem eixo de provider — o mesmo modelo em dois providers é UMA linha', async () => {
    const { ws, sessaoA, modelo } = await setup();

    await gasto({
      sessionId: sessaoA.id,
      modelId: modelo.id,
      provider: 'openrouter',
      modelName: 'compartilhado/modelo',
      actorKind: 'agent',
      actorId: 'criativo',
      costMicros: 100,
    });
    await gasto({
      sessionId: sessaoA.id,
      modelId: modelo.id,
      provider: 'openai',
      modelName: 'compartilhado/modelo',
      actorKind: 'agent',
      actorId: 'criativo',
      costMicros: 400,
    });

    const relatorio = await relatorioDoOwner.execute(ws.id, 30);

    expect(relatorio.porModelo).toHaveLength(1);
    expect(relatorio.porModelo[0].costMicros).toBe(500);
    expect(JSON.stringify(relatorio)).not.toContain('openrouter');
  });

  it('workspace sem gasto devolve relatório vazio com série densa, não erro', async () => {
    const { ws } = await setup();

    const relatorio = await relatorioDoOwner.execute(ws.id, 7);

    expect(relatorio.totalMicros).toBe(0);
    expect(relatorio.porModelo).toEqual([]);
    expect(relatorio.porDia).toHaveLength(7);
    expect(relatorio.porDia.every((p) => p.costMicros === 0)).toBe(true);
  });

  it('gasto de OUTRO workspace não entra', async () => {
    const { ws, dono, sessaoA, modelo } = await setup();
    const [outroWs] = await db
      .insert(workspaces)
      .values({ name: 'Outra', slug: 'outra-spend', createdBy: dono.id })
      .returning();
    const [outroProjeto] = await db
      .insert(projects)
      .values({
        workspaceId: outroWs.id,
        name: 'X',
        slug: 'x-spend',
        createdBy: dono.id,
      })
      .returning();
    const [outraSessao] = await db
      .insert(sessions)
      .values({ projectId: outroProjeto.id, createdBy: dono.id })
      .returning();

    await gasto({
      sessionId: sessaoA.id,
      modelId: modelo.id,
      actorKind: 'agent',
      actorId: 'criativo',
      costMicros: 100,
    });
    await gasto({
      sessionId: outraSessao.id,
      modelId: modelo.id,
      actorKind: 'agent',
      actorId: 'criativo',
      costMicros: 999,
    });

    expect((await relatorioDoOwner.execute(ws.id, 30)).totalMicros).toBe(100);
  });
});

describe('GetMySpendUseCase — a audiência do membro', () => {
  /**
   * O teste que a FASE 22 existe para escrever. A mesma sessão tem gasto de
   * três atores; o membro enxerga UM. Tirar o filtro de ator do escopo em
   * `GetMySpendUseCase` faz esta asserção morrer — foi verificado por mutação.
   */
  it('não enxerga linha de OUTRO ator, nem de agente, nem do owner', async () => {
    const { loja, sessaoA, modelo, membro, outro, dono } = await setup();

    await gasto({
      sessionId: sessaoA.id,
      modelId: modelo.id,
      actorKind: 'user',
      actorId: membro.id,
      costMicros: 700,
    });
    await gasto({
      sessionId: sessaoA.id,
      modelId: modelo.id,
      actorKind: 'user',
      actorId: outro.id,
      costMicros: 5_000,
    });
    await gasto({
      sessionId: sessaoA.id,
      modelId: modelo.id,
      actorKind: 'user',
      actorId: dono.id,
      costMicros: 9_000,
    });
    // O agente gasta a chave do OWNER (RN-058) e não é ninguém: `token_usage`
    // registra quem gastou, não quem mandou gastar.
    await gasto({
      sessionId: sessaoA.id,
      modelId: modelo.id,
      actorKind: 'agent',
      actorId: 'criativo',
      costMicros: 3_000,
    });

    const meu = await meuConsumo.execute(loja.id, membro.id, 30);

    expect(meu.actorId).toBe(membro.id);
    expect(meu.totalMicros).toBe(700);
    expect(meu.chamadas).toBe(1);
    expect(meu.porSessao).toHaveLength(1);
    expect(meu.porSessao[0].chave).toBe(sessaoA.id);
    expect(meu.porDia.reduce((n, p) => n + p.costMicros, 0)).toBe(700);
  });

  /**
   * Um `actor_id` de agente pode coincidir com nada, mas o par (kind, id) é o
   * que identifica: filtrar só pelo id deixaria um agente com slug igual a um
   * uuid escapar. O filtro é pelos DOIS.
   */
  it('o filtro é pelo par (kind, id), não só pelo id', async () => {
    const { loja, sessaoA, modelo, membro } = await setup();

    await gasto({
      sessionId: sessaoA.id,
      modelId: modelo.id,
      actorKind: 'agent',
      actorId: membro.id,
      costMicros: 4_000,
    });

    const meu = await meuConsumo.execute(loja.id, membro.id, 30);

    expect(meu.totalMicros).toBe(0);
  });

  it('quebra o meu consumo por SESSÃO, e só do projeto pedido', async () => {
    const { loja, portal, sessaoA, sessaoB, sessaoPortal, modelo, membro } =
      await setup();

    await gasto({
      sessionId: sessaoA.id,
      modelId: modelo.id,
      actorKind: 'user',
      actorId: membro.id,
      costMicros: 200,
    });
    await gasto({
      sessionId: sessaoB.id,
      modelId: modelo.id,
      actorKind: 'user',
      actorId: membro.id,
      costMicros: 800,
    });
    await gasto({
      sessionId: sessaoPortal.id,
      modelId: modelo.id,
      actorKind: 'user',
      actorId: membro.id,
      costMicros: 50,
    });

    const naLoja = await meuConsumo.execute(loja.id, membro.id, 30);
    expect(naLoja.totalMicros).toBe(1_000);
    expect(naLoja.porSessao.map((l) => [l.chave, l.costMicros])).toEqual([
      [sessaoB.id, 800],
      [sessaoA.id, 200],
    ]);

    const noPortal = await meuConsumo.execute(portal.id, membro.id, 30);
    expect(noPortal.totalMicros).toBe(50);
  });

  /**
   * O que o membro NÃO recebe: nem provider, nem credencial. É a metade da
   * RN-101 que protege a RN-060 — a resposta não é uma fatia da fatura de
   * outra pessoa.
   */
  it('a resposta não carrega provider nem credencial', async () => {
    const { loja, sessaoA, modelo, membro } = await setup();
    await gasto({
      sessionId: sessaoA.id,
      modelId: modelo.id,
      provider: 'openrouter',
      actorKind: 'user',
      actorId: membro.id,
      costMicros: 700,
    });

    const meu = await meuConsumo.execute(loja.id, membro.id, 30);

    expect(Object.keys(meu)).not.toContain('porProvider');
    expect(JSON.stringify(meu)).not.toContain('openrouter');
  });

  it('quem nunca gastou recebe zero com série densa, não erro', async () => {
    const { loja, outro } = await setup();

    const meu = await meuConsumo.execute(loja.id, outro.id, 5);

    expect(meu.totalMicros).toBe(0);
    expect(meu.porSessao).toEqual([]);
    expect(meu.porDia).toHaveLength(5);
  });
});
