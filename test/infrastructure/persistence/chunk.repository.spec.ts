import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../support/test-db';
import { projects, sessions, users, workspaces } from '../../../src/db/schema';
import { DrizzleChunkRepository } from '../../../src/infrastructure/persistence/drizzle/chunk.repository';

const { db, pool } = createTestDb();
const repo = new DrizzleChunkRepository(db);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function seedProjetoESessao() {
  const [owner] = await db
    .insert(users)
    .values({ email: 'chunk-repo@brabo.dev' })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'acme-chunks', slug: 'acme-chunks', createdBy: owner.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: ws.id,
      name: 'core',
      slug: 'core',
      workspaceDirName: 'core-chunks',
      createdBy: owner.id,
    })
    .returning();
  const [session] = await db
    .insert(sessions)
    .values({ projectId: project.id, createdBy: owner.id, status: 'active' })
    .returning();

  return { owner, project, session };
}

describe('DrizzleChunkRepository', () => {
  it('grava um chunk de docs com vetor e devolve o search_vector gerado pela GENERATED ALWAYS AS', async () => {
    const { project } = await seedProjetoESessao();
    const embedding = new Array(768).fill(0).map((_, i) => i / 768);

    const chunk = await repo.create({
      projectId: project.id,
      scope: 'docs',
      sourcePath: 'docs/intro.md',
      content: 'Brabo é uma plataforma de engenharia orquestrada por agentes.',
      embedding,
    });

    expect(chunk.id).toBeDefined();
    expect(chunk.scope).toBe('docs');
    expect(chunk.sourcePath).toBe('docs/intro.md');
    expect(chunk.sessionId).toBeNull();
    expect(chunk.embedding).toHaveLength(768);
    expect(chunk.embedding![0]).toBeCloseTo(0, 5);
    expect(chunk.metadata).toEqual({});

    const encontrado = await repo.findById(chunk.id);
    expect(encontrado?.content).toBe(chunk.content);
  });

  it('createMany grava um lote e listByProject filtra por escopo, sem misturar docs e session', async () => {
    const { project, session } = await seedProjetoESessao();

    await repo.createMany([
      {
        projectId: project.id,
        scope: 'docs',
        sourcePath: 'docs/intro.md',
        content: 'trecho um',
      },
      {
        projectId: project.id,
        scope: 'adr',
        sourcePath: 'docs/adr/0001-teste.md',
        content: 'trecho dois',
        metadata: { title: 'ADR de teste', chunkIndex: 0, totalChunks: 1 },
      },
      {
        projectId: project.id,
        scope: 'session',
        sessionId: session.id,
        content: 'trecho três',
      },
    ]);

    const docs = await repo.listByProject(project.id, 'docs');
    expect(docs).toHaveLength(1);
    expect(docs[0].content).toBe('trecho um');

    const todos = await repo.listByProject(project.id);
    expect(todos).toHaveLength(3);

    const adr = await repo.listByProject(project.id, 'adr');
    expect(adr[0].metadata.title).toBe('ADR de teste');
  });

  it('recusa chunk de docs sem source_path — o CHECK da migração 0045, não validação de aplicação', async () => {
    const { project } = await seedProjetoESessao();

    await expect(
      repo.create({
        projectId: project.id,
        scope: 'docs',
        content: 'sem caminho de origem',
      }),
    ).rejects.toThrow();
  });

  // ---------------------------------------------------------- Onda 4 (G2)

  it('deleteByScope apaga só o escopo pedido do projeto, devolvendo a contagem', async () => {
    const { project } = await seedProjetoESessao();
    await repo.createMany([
      { projectId: project.id, scope: 'docs', sourcePath: 'docs/a.md', content: 'x' },
      { projectId: project.id, scope: 'docs', sourcePath: 'docs/b.md', content: 'y' },
      {
        projectId: project.id,
        scope: 'adr',
        sourcePath: 'docs/adr/0001.md',
        content: 'z',
      },
    ]);

    const apagados = await repo.deleteByScope(project.id, 'docs');

    expect(apagados).toBe(2);
    expect(await repo.listByProject(project.id, 'docs')).toHaveLength(0);
    expect(await repo.listByProject(project.id, 'adr')).toHaveLength(1);
  });

  it('deleteByScope num projeto sem nada naquele escopo devolve 0, sem lançar', async () => {
    const { project } = await seedProjetoESessao();

    await expect(repo.deleteByScope(project.id, 'docs')).resolves.toBe(0);
  });

  it('deleteBySession apaga só os chunks DAQUELA sessão, preservando outra sessão do mesmo projeto', async () => {
    const { project, session } = await seedProjetoESessao();
    const [outraSessao] = await db
      .insert(sessions)
      .values({ projectId: project.id, createdBy: session.createdBy, status: 'active' })
      .returning();

    await repo.createMany([
      { projectId: project.id, scope: 'session', sessionId: session.id, content: 'da primeira' },
      {
        projectId: project.id,
        scope: 'session',
        sessionId: outraSessao.id,
        content: 'da segunda',
      },
    ]);

    const apagados = await repo.deleteBySession(session.id);

    expect(apagados).toBe(1);
    const restantes = await repo.listByProject(project.id, 'session');
    expect(restantes).toHaveLength(1);
    expect(restantes[0].sessionId).toBe(outraSessao.id);
  });

  it('searchByVector devolve os chunks mais próximos por cosseno, ignorando os SEM vetor', async () => {
    const { project } = await seedProjetoESessao();
    const vetorA = new Array(768).fill(0);
    vetorA[0] = 1;
    const vetorB = new Array(768).fill(0);
    vetorB[1] = 1;

    await repo.createMany([
      {
        projectId: project.id,
        scope: 'docs',
        sourcePath: 'docs/a.md',
        content: 'conteúdo A',
        embedding: vetorA,
      },
      {
        projectId: project.id,
        scope: 'docs',
        sourcePath: 'docs/b.md',
        content: 'conteúdo B',
        embedding: vetorB,
      },
      {
        projectId: project.id,
        scope: 'docs',
        sourcePath: 'docs/c.md',
        content: 'conteúdo C sem vetor',
      },
    ]);

    const resultado = await repo.searchByVector(project.id, vetorA, { limit: 10 });

    expect(resultado.map((r) => r.chunk.content)).toEqual(['conteúdo A', 'conteúdo B']);
    expect(resultado[0].score).toBeCloseTo(1, 5);
    expect(resultado[1].score).toBeCloseTo(0, 5);
  });

  it('searchByVector sem NENHUM chunk com vetor no projeto devolve lista vazia', async () => {
    const { project } = await seedProjetoESessao();
    await repo.create({
      projectId: project.id,
      scope: 'docs',
      sourcePath: 'docs/a.md',
      content: 'sem vetor nenhum',
    });

    const resultado = await repo.searchByVector(project.id, new Array(768).fill(0), {
      limit: 10,
    });

    expect(resultado).toEqual([]);
  });

  it('searchByLexicalQuery casa por tsvector em português, ordenado por ts_rank', async () => {
    const { project } = await seedProjetoESessao();
    await repo.createMany([
      {
        projectId: project.id,
        scope: 'docs',
        sourcePath: 'docs/a.md',
        content:
          'engenharia de agentes é o tema central deste documento sobre engenharia de software',
      },
      {
        projectId: project.id,
        scope: 'docs',
        sourcePath: 'docs/b.md',
        content: 'psicólogo cuida da saúde do time',
      },
    ]);

    const resultado = await repo.searchByLexicalQuery(project.id, 'engenharia', { limit: 10 });

    expect(resultado).toHaveLength(1);
    expect(resultado[0].chunk.sourcePath).toBe('docs/a.md');
    expect(resultado[0].score).toBeGreaterThan(0);
    expect(resultado[0].score).toBeLessThan(1);
  });

  it('searchByLexicalQuery sem casamento nenhum devolve lista vazia, sem lançar', async () => {
    const { project } = await seedProjetoESessao();
    await repo.create({
      projectId: project.id,
      scope: 'docs',
      sourcePath: 'docs/a.md',
      content: 'um trecho qualquer sobre jardinagem',
    });

    const resultado = await repo.searchByLexicalQuery(project.id, 'blockchain', { limit: 10 });

    expect(resultado).toEqual([]);
  });
});
