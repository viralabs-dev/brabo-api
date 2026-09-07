import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { projects, users, workspaces } from '../../../../src/db/schema';
import { DrizzleMirrorStateRepository } from '../../../../src/infrastructure/persistence/drizzle/mirror-state.repository';

/**
 * A telemetria do espelho contra o banco de verdade (RN-517, ADR 0147 ponto 7).
 *
 * O invariante que só o SQL prova: os dois caminhos de escrita mencionam
 * colunas DISJUNTAS no `onConflictDoUpdate`, e por isso um sucesso e um erro
 * convivem na mesma linha sem que um apague o outro. Um fake não provaria
 * isso — provaria o fake.
 */

const { db, pool } = createTestDb();
const repo = new DrizzleMirrorStateRepository(db);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function criarProjeto() {
  const [user] = await db
    .insert(users)
    .values({
      keycloakSub: 'sub-project-mirror-states',
      email: 'espelho@brabo.dev',
    })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: user.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'core',
      slug: 'core',
      // RN-109: `workspace_dir_name` é NOT NULL na api, e omiti-lo aqui é o
      // que faz `tsc -b` (o typecheck do CI, que enxerga os testes) reprovar.
      workspaceDirName: 'core-abcdefgh',
      createdBy: user.id,
    })
    .returning();
  return project;
}

describe('DrizzleMirrorStateRepository (RN-517)', () => {
  it('sem linha nenhuma, findByProject é null — o estado "nunca sincronizou"', async () => {
    const project = await criarProjeto();
    expect(await repo.findByProject(project.id)).toBeNull();
  });

  it('recordSuccess cria a linha com as três contagens e o destino congelado', async () => {
    const project = await criarProjeto();

    await repo.recordSuccess({
      projectId: project.id,
      destination: '/home/voce/espelhos/core',
      filesCopied: 412,
      filesSkipped: 3,
      filesRefused: 0,
      syncedAt: new Date('2026-09-07T10:00:00Z'),
    });

    expect(await repo.findByProject(project.id)).toMatchObject({
      filesCopied: 412,
      filesSkipped: 3,
      filesRefused: 0,
      destination: '/home/voce/espelhos/core',
      lastError: null,
      lastErrorAt: null,
    });
  });

  it('recordFailure NÃO apaga a última sincronização boa nem as contagens', async () => {
    const project = await criarProjeto();
    await repo.recordSuccess({
      projectId: project.id,
      destination: '/home/voce/espelhos/core',
      filesCopied: 412,
      filesSkipped: 0,
      filesRefused: 0,
      syncedAt: new Date('2026-09-06T10:00:00Z'),
    });

    await repo.recordFailure({
      projectId: project.id,
      destination: null,
      error: 'git falhou',
      failedAt: new Date('2026-09-07T10:00:00Z'),
    });

    const linha = await repo.findByProject(project.id);
    expect(linha?.lastSyncedAt).toEqual(new Date('2026-09-06T10:00:00Z'));
    expect(linha?.filesCopied).toBe(412);
    // Destino ausente na falha não apaga o da última cópia que funcionou.
    expect(linha?.destination).toBe('/home/voce/espelhos/core');
    expect(linha?.lastError).toBe('git falhou');
  });

  it('recordSuccess depois de uma falha NÃO apaga o último erro', async () => {
    const project = await criarProjeto();
    await repo.recordFailure({
      projectId: project.id,
      destination: null,
      error: 'git falhou',
      failedAt: new Date('2026-09-06T10:00:00Z'),
    });

    await repo.recordSuccess({
      projectId: project.id,
      destination: '/home/voce/espelhos/core',
      filesCopied: 1,
      filesSkipped: 0,
      filesRefused: 0,
      syncedAt: new Date('2026-09-07T10:00:00Z'),
    });

    const linha = await repo.findByProject(project.id);
    expect(linha?.lastError).toBe('git falhou');
    expect(linha?.lastErrorAt).toEqual(new Date('2026-09-06T10:00:00Z'));
    expect(linha?.lastSyncedAt).toEqual(new Date('2026-09-07T10:00:00Z'));
  });

  it('uma linha por projeto: a segunda rodada atualiza, nunca insere outra', async () => {
    const project = await criarProjeto();
    await repo.recordSuccess({
      projectId: project.id,
      destination: '/d1',
      filesCopied: 1,
      filesSkipped: 0,
      filesRefused: 0,
      syncedAt: new Date('2026-09-06T10:00:00Z'),
    });
    await repo.recordSuccess({
      projectId: project.id,
      destination: '/d2',
      filesCopied: 9,
      filesSkipped: 0,
      filesRefused: 0,
      syncedAt: new Date('2026-09-07T10:00:00Z'),
    });

    const linha = await repo.findByProject(project.id);
    expect(linha?.destination).toBe('/d2');
    expect(linha?.filesCopied).toBe(9);
  });
});
