import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projects,
  sessions,
  users,
  workspaces,
  workspaceMembers,
  proposedActions,
} from '../../../../src/db/schema';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { DrizzleProposedActionRepository } from '../../../../src/infrastructure/persistence/drizzle/proposed-action.repository';
import { ListProjectPendingActionsUseCase } from '../../../../src/application/use-cases/actions/list-project-pending-actions.use-case';

const { db, pool } = createTestDb();
const projectRepo = new DrizzleProjectRepository(db);
const proposedActionRepo = new DrizzleProposedActionRepository(db);
const listProjectPendingActions = new ListProjectPendingActionsUseCase(
  projectRepo,
  proposedActionRepo,
);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function setupProjectComDuasSessoes() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-prs', email: 'prs@brabo.dev' })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: user.id })
    .returning();
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: user.id, role: 'owner' });
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'core',
      slug: 'core',
      createdBy: user.id,
    })
    .returning();
  const [sessaoAntiga] = await db
    .insert(sessions)
    .values({ projectId: project.id, createdBy: user.id })
    .returning();
  const [sessaoRecente] = await db
    .insert(sessions)
    .values({ projectId: project.id, createdBy: user.id })
    .returning();
  return { user, project, sessaoAntiga, sessaoRecente };
}

/**
 * `findPendingByProject` (Onda 2 — aba PRs) é a peça que resolve o bug de
 * visibilidade de `ProjectApprovalsTab.tsx`: uma ação pendente proposta numa
 * sessão ANTIGA continua achável mesmo depois de uma sessão nova nascer —
 * diferente de `listPaginated`/`usePendingActions`, que são escopados por
 * SESSÃO e só enxergam a mais recente quando é ela que o chamador passa.
 */
describe('ListProjectPendingActionsUseCase', () => {
  it('acha ação PENDENTE de uma sessão ANTIGA mesmo com uma sessão mais nova já existindo', async () => {
    const { project, sessaoAntiga, sessaoRecente } =
      await setupProjectComDuasSessoes();

    // A sessão RECENTE existe (é o que faria `usePendingActions(latestSession)`
    // olhar só para ela e nunca achar a ação abaixo), mas não propõe nada.
    void sessaoRecente;

    const [acaoPendente] = await db
      .insert(proposedActions)
      .values({
        projectId: project.id,
        sessionId: sessaoAntiga.id,
        actionType: 'git_merge',
        payload: { pullRequestId: 'pr-1', targetBranch: 'dev' },
        status: 'pending',
        resolvedPolicy: 'require_approval',
        actorKind: 'user',
        actorId: 'user-1',
      })
      .returning();

    const encontradas = await listProjectPendingActions.execute(
      project.id,
      'git_merge',
    );

    expect(encontradas).toHaveLength(1);
    expect(encontradas[0].id).toBe(acaoPendente.id);
    expect(encontradas[0].sessionId).toBe(sessaoAntiga.id);
  });

  it('actionType filtra por tipo — sem ele, devolve pendentes de QUALQUER tipo', async () => {
    const { project, sessaoAntiga } = await setupProjectComDuasSessoes();

    await db.insert(proposedActions).values([
      {
        projectId: project.id,
        sessionId: sessaoAntiga.id,
        actionType: 'git_merge',
        payload: { pullRequestId: 'pr-1', targetBranch: 'dev' },
        status: 'pending',
        resolvedPolicy: 'require_approval',
        actorKind: 'user',
        actorId: 'user-1',
      },
      {
        projectId: project.id,
        sessionId: sessaoAntiga.id,
        actionType: 'terminal',
        payload: { command: 'echo oi' },
        status: 'pending',
        resolvedPolicy: 'require_approval',
        actorKind: 'agent',
        actorId: 'dev-api',
      },
    ]);

    const soGitMerge = await listProjectPendingActions.execute(
      project.id,
      'git_merge',
    );
    expect(soGitMerge.map((a) => a.actionType)).toEqual(['git_merge']);

    const todas = await listProjectPendingActions.execute(project.id);
    expect(todas).toHaveLength(2);
  });

  it('nunca devolve ação já DECIDIDA (aprovada/negada/executada) — só pending', async () => {
    const { project, sessaoAntiga, user } = await setupProjectComDuasSessoes();

    await db.insert(proposedActions).values({
      projectId: project.id,
      sessionId: sessaoAntiga.id,
      actionType: 'git_merge',
      payload: { pullRequestId: 'pr-2', targetBranch: 'dev' },
      status: 'executed',
      resolvedPolicy: 'require_approval',
      actorKind: 'user',
      actorId: 'user-1',
      decidedBy: user.id,
      decidedAt: new Date(),
    });

    const encontradas = await listProjectPendingActions.execute(
      project.id,
      'git_merge',
    );
    expect(encontradas).toHaveLength(0);
  });

  it('rejeita projeto inexistente', async () => {
    await expect(
      listProjectPendingActions.execute('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(NotFoundException);
  });
});
