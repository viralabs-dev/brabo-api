import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projectMembers,
  projects,
  users,
  workspaceMembers,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';

/**
 * `listRunnerModeReachableBy` (RN-543, ADR 0154 ponto 3) — a consulta de
 * CANDIDATOS de `GET /runner/projects`.
 *
 * Provada contra o Postgres porque o que ela decide é SQL: os dois `exists`
 * em `or` (linha em `project_members` OU em `workspace_members`) e o filtro
 * de `execution_mode`. O papel EFETIVO não é decidido aqui — quem o decide é
 * `ResolveEffectiveRoleUseCase`, e o caso disso está no spec do caso de uso.
 */
const { db, pool } = createTestDb();
const repo = new DrizzleProjectRepository(db);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function cenario() {
  const [dono] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-dono', email: 'dono@brabo.dev' })
    .returning();
  const [membro] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-membro', email: 'membro@brabo.dev' })
    .returning();
  const [estranho] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-estranho', email: 'estranho@brabo.dev' })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: dono.id })
    .returning();

  const criarProjeto = async (
    slug: string,
    executionMode: 'container' | 'mounted' | 'runner',
  ) => {
    const [projeto] = await db
      .insert(projects)
      .values({
        workspaceId: workspace.id,
        name: slug,
        slug,
        workspaceDirName: `${slug}-dir`,
        executionMode,
        workspacePath:
          executionMode === 'container' ? null : `/home/dev/${slug}`,
        createdBy: dono.id,
      })
      .returning();
    return projeto;
  };

  return { dono, membro, estranho, workspace, criarProjeto };
}

describe('DrizzleProjectRepository.listRunnerModeReachableBy', () => {
  it('caminho feliz: traz o projeto `runner` de quem tem linha em project_members', async () => {
    const { membro, criarProjeto } = await cenario();
    const projeto = await criarProjeto('runner-um', 'runner');
    await db
      .insert(projectMembers)
      .values({ projectId: projeto.id, userId: membro.id, role: 'developer' });

    const achados = await repo.listRunnerModeReachableBy(membro.id);

    expect(achados.map((p) => p.id)).toEqual([projeto.id]);
  });

  it('a linha de WORKSPACE também alcança — a sobreposição da RN-471 vale nos dois sentidos', async () => {
    const { membro, workspace, criarProjeto } = await cenario();
    const projeto = await criarProjeto('runner-um', 'runner');
    await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: membro.id,
      role: 'maintainer',
    });

    const achados = await repo.listRunnerModeReachableBy(membro.id);

    expect(achados.map((p) => p.id)).toEqual([projeto.id]);
  });

  it('linha nos DOIS lugares não duplica o projeto', async () => {
    const { membro, workspace, criarProjeto } = await cenario();
    const projeto = await criarProjeto('runner-um', 'runner');
    await db
      .insert(projectMembers)
      .values({ projectId: projeto.id, userId: membro.id, role: 'viewer' });
    await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: membro.id,
      role: 'owner',
    });

    expect(await repo.listRunnerModeReachableBy(membro.id)).toHaveLength(1);
  });

  it('CASO DE FALHA: projeto `container`/`mounted` nunca entra, mesmo alcançado', async () => {
    const { membro, workspace, criarProjeto } = await cenario();
    await criarProjeto('gerenciado', 'container');
    await criarProjeto('montado', 'mounted');
    await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: membro.id,
      role: 'owner',
    });

    expect(await repo.listRunnerModeReachableBy(membro.id)).toEqual([]);
  });

  it('CASO DE FALHA: quem não tem linha nenhuma não alcança projeto nenhum', async () => {
    const { estranho, criarProjeto } = await cenario();
    await criarProjeto('runner-um', 'runner');

    expect(await repo.listRunnerModeReachableBy(estranho.id)).toEqual([]);
  });

  it('ordena por nome, para a resposta ser estável entre chamadas', async () => {
    const { membro, workspace, criarProjeto } = await cenario();
    await criarProjeto('zeta', 'runner');
    await criarProjeto('alfa', 'runner');
    await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: membro.id,
      role: 'developer',
    });

    const achados = await repo.listRunnerModeReachableBy(membro.id);

    expect(achados.map((p) => p.name)).toEqual(['alfa', 'zeta']);
  });
});
