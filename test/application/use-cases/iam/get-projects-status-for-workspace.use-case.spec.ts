import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  epics,
  projects,
  sessions,
  stories,
  tasks,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleTaskRepository } from '../../../../src/infrastructure/persistence/drizzle/backlog.repository';
import { GetProjectsStatusForWorkspaceUseCase } from '../../../../src/application/use-cases/iam/get-projects-status-for-workspace.use-case';

const { db, pool } = createTestDb();
const taskRepo = new DrizzleTaskRepository(db);
const getProjectsStatus = new GetProjectsStatusForWorkspaceUseCase(taskRepo);

async function createUser(email: string) {
  const [row] = await db
    .insert(users)
    .values({ keycloakSub: `sub-${email}`, email, name: email })
    .returning();
  return row;
}

async function createWorkspace(ownerId: string, slug: string) {
  const [row] = await db
    .insert(workspaces)
    .values({ name: slug, slug, createdBy: ownerId })
    .returning();
  return row;
}

async function createProject(
  workspaceId: string,
  ownerId: string,
  slug: string,
) {
  const [row] = await db
    .insert(projects)
    .values({ workspaceId, name: slug, slug, createdBy: ownerId })
    .returning();
  return row;
}

async function createStory(projectId: string, ownerId: string) {
  const [session] = await db
    .insert(sessions)
    .values({ projectId, createdBy: ownerId })
    .returning();
  const [epic] = await db
    .insert(epics)
    .values({ projectId, sessionId: session.id, title: 'Épico' })
    .returning();
  const [story] = await db
    .insert(stories)
    .values({
      epicId: epic.id,
      projectId,
      sessionId: session.id,
      title: 'História',
    })
    .returning();
  return story;
}

async function createTask(storyId: string, blocked: boolean) {
  await db.insert(tasks).values({ storyId, title: 'Task', blocked });
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('GetProjectsStatusForWorkspaceUseCase', () => {
  it('workspace sem task bloqueada: lista vazia', async () => {
    const owner = await createUser('owner@brabo.dev');
    const workspace = await createWorkspace(owner.id, 'vazio');
    const project = await createProject(workspace.id, owner.id, 'core');
    const story = await createStory(project.id, owner.id);
    await createTask(story.id, false);

    const result = await getProjectsStatus.execute(workspace.id);

    expect(result).toEqual([]);
  });

  it('conta tasks bloqueadas por projeto, numa query só pro workspace inteiro', async () => {
    const owner = await createUser('owner2@brabo.dev');
    const workspace = await createWorkspace(owner.id, 'acme');
    const projectA = await createProject(workspace.id, owner.id, 'core');
    const projectB = await createProject(workspace.id, owner.id, 'web');
    const storyA = await createStory(projectA.id, owner.id);
    const storyB = await createStory(projectB.id, owner.id);

    await createTask(storyA.id, true);
    await createTask(storyA.id, true);
    await createTask(storyA.id, false);
    await createTask(storyB.id, true);

    const result = await getProjectsStatus.execute(workspace.id);

    expect(
      result.sort((a, b) => a.projectId.localeCompare(b.projectId)),
    ).toEqual(
      [
        { projectId: projectA.id, blockedTaskCount: 2 },
        { projectId: projectB.id, blockedTaskCount: 1 },
      ].sort((a, b) => a.projectId.localeCompare(b.projectId)),
    );
  });

  it('não mistura task bloqueada de outro workspace', async () => {
    const owner = await createUser('owner3@brabo.dev');
    const workspaceA = await createWorkspace(owner.id, 'acme3a');
    const workspaceB = await createWorkspace(owner.id, 'acme3b');
    const projectA = await createProject(workspaceA.id, owner.id, 'core');
    const projectB = await createProject(workspaceB.id, owner.id, 'core');
    const storyA = await createStory(projectA.id, owner.id);
    const storyB = await createStory(projectB.id, owner.id);

    await createTask(storyA.id, true);
    await createTask(storyB.id, true);

    const result = await getProjectsStatus.execute(workspaceA.id);

    expect(result).toEqual([{ projectId: projectA.id, blockedTaskCount: 1 }]);
  });
});
