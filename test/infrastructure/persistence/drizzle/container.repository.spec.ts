import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { projects, users, workspaces } from '../../../../src/db/schema';
import { RECURSOS_PADRAO } from '../../../../src/domain/containers/project-container';
import { DrizzleContainerRepository } from '../../../../src/infrastructure/persistence/drizzle/container.repository';

const { db, pool } = createTestDb();
const repo = new DrizzleContainerRepository(db);

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
      keycloakSub: 'sub-project-containers',
      email: 'containers@brabo.dev',
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
      createdBy: user.id,
    })
    .returning();
  return project;
}

describe('DrizzleContainerRepository', () => {
  it('nasce sem linha: findByProject devolve null antes de qualquer create', async () => {
    const project = await criarProjeto();
    expect(await repo.findByProject(project.id)).toBeNull();
  });

  it('create nasce em `provisioning`, com a versão e os recursos passados', async () => {
    const project = await criarProjeto();
    const criada = await repo.create({
      projectId: project.id,
      imageVersion: 2,
      resources: RECURSOS_PADRAO,
    });

    expect(criada.status).toBe('provisioning');
    expect(criada.imageVersion).toBe(2);
    expect(criada.containerId).toBeNull();
    expect(criada.resources).toEqual(RECURSOS_PADRAO);

    const lida = await repo.findByProject(project.id);
    expect(lida?.id).toBe(criada.id);
  });

  it('updateStatus transiciona e grava containerId/failureReason quando informados', async () => {
    const project = await criarProjeto();
    const criada = await repo.create({
      projectId: project.id,
      imageVersion: 1,
      resources: RECURSOS_PADRAO,
    });

    const rodando = await repo.updateStatus(criada.id, 'running', {
      containerId: 'docker-abc',
    });
    expect(rodando.status).toBe('running');
    expect(rodando.containerId).toBe('docker-abc');

    const falhou = await repo.updateStatus(criada.id, 'failed', {
      failureReason: 'crashou ao subir',
    });
    expect(falhou.status).toBe('failed');
    expect(falhou.failureReason).toBe('crashou ao subir');
    // containerId gravado antes não some numa transição que não o menciona.
    expect(falhou.containerId).toBe('docker-abc');
  });

  it('só uma linha por projeto — create duplicado viola a constraint única', async () => {
    const project = await criarProjeto();
    await repo.create({
      projectId: project.id,
      imageVersion: 1,
      resources: RECURSOS_PADRAO,
    });

    await expect(
      repo.create({
        projectId: project.id,
        imageVersion: 2,
        resources: RECURSOS_PADRAO,
      }),
    ).rejects.toThrow();
  });
});
