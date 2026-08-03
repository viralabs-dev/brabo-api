import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { ulid } from 'ulid';
import { createTestDb, truncateAll } from '../../support/test-db';
import {
  projects,
  sessionEvents,
  sessions,
  users,
  workspaces,
} from '../../../src/db/schema';
import { DrizzleSessionRepository } from '../../../src/infrastructure/persistence/drizzle/session.repository';

const { db, pool } = createTestDb();
const repo = new DrizzleSessionRepository(db);

/**
 * `findActiveExecutionSession` é SQL puro — nenhum teste de caso de uso a
 * exercita, porque todos falsificam o repositório. Aqui ela roda contra o
 * banco de verdade.
 *
 * Ela existe por causa do achado #11 do primeiro dogfooding: a ativação criava
 * sessão incondicionalmente, e cada reativação deixava para trás uma sessão
 * `active` que recebia o `execution.activated` e nada mais.
 */
async function seedProjeto(): Promise<string> {
  const [owner] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-exec', email: 'exec@brabo.dev' })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: owner.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: ws.id,
      name: 'core',
      slug: 'core',
      createdBy: owner.id,
    })
    .returning();
  return project.id;
}

async function seedSessao(
  projectId: string,
  opts: { status: 'created' | 'active' | 'closed'; comAtivacao: boolean },
): Promise<string> {
  const [owner] = await db.select().from(users);
  const [session] = await db
    .insert(sessions)
    .values({ projectId, createdBy: owner.id, status: opts.status })
    .returning();

  if (opts.comAtivacao) {
    await db.insert(sessionEvents).values({
      id: ulid(),
      sessionId: session.id,
      seq: 1,
      type: 'execution.activated',
      actorKind: 'user',
      actorId: owner.id,
      payload: {},
    });
  }

  return session.id;
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('DrizzleSessionRepository.findActiveExecutionSession', () => {
  it('projeto sem execução nenhuma: null', async () => {
    const projectId = await seedProjeto();
    await seedSessao(projectId, { status: 'active', comAtivacao: false });

    expect(await repo.findActiveExecutionSession(projectId)).toBeNull();
  });

  it('acha a sessão `active` que carrega o execution.activated', async () => {
    const projectId = await seedProjeto();
    // Uma sessão de conversa, ativa, SEM ativação de execução — não pode ser
    // confundida com a de execução só por estar `active`.
    await seedSessao(projectId, { status: 'active', comAtivacao: false });
    const execucao = await seedSessao(projectId, {
      status: 'active',
      comAtivacao: true,
    });

    const achada = await repo.findActiveExecutionSession(projectId);

    expect(achada?.id).toBe(execucao);
  });

  it('sessão de execução já fechada não conta', async () => {
    const projectId = await seedProjeto();
    await seedSessao(projectId, { status: 'closed', comAtivacao: true });

    // Fechar a sessão é o jeito de recomeçar do zero: a próxima ativação
    // precisa abrir uma nova, não ressuscitar a fechada.
    expect(await repo.findActiveExecutionSession(projectId)).toBeNull();
  });

  it('não vaza a sessão de execução de OUTRO projeto', async () => {
    const projectId = await seedProjeto();
    await seedSessao(projectId, { status: 'active', comAtivacao: true });

    const [outroProjeto] = await db
      .insert(projects)
      .values({
        workspaceId: (await db.select().from(workspaces))[0].id,
        name: 'outro',
        slug: 'outro',
        createdBy: (await db.select().from(users))[0].id,
      })
      .returning();

    expect(await repo.findActiveExecutionSession(outroProjeto.id)).toBeNull();
  });
});
