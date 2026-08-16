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
});
