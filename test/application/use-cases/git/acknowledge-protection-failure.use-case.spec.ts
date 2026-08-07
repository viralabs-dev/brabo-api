import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projects,
  sessions,
  users,
  workspaces,
  workspaceMembers,
} from '../../../../src/db/schema';
import { DrizzleRepoBootstrapRepository } from '../../../../src/infrastructure/persistence/drizzle/repo-bootstrap.repository';
import { DrizzleSessionRepository } from '../../../../src/infrastructure/persistence/drizzle/session.repository';
import { DrizzleSessionEventRepository } from '../../../../src/infrastructure/persistence/drizzle/session-event.repository';
import { DrizzleOutboxRepository } from '../../../../src/infrastructure/persistence/drizzle/outbox.repository';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import { AcknowledgeProtectionFailureUseCase } from '../../../../src/application/use-cases/git/acknowledge-protection-failure.use-case';

/**
 * A saída do beco sem saída (achado D).
 *
 * `protect_branches` falha em repositório privado no plano gratuito, e o único
 * botão era "Tentar novamente" — que falha sempre pelo mesmo motivo. Pior:
 * `provision_failed` faz o dashboard redirecionar o projeto de volta para a
 * página de provisionamento, deixando-o INALCANÇÁVEL.
 */
const { db, pool } = createTestDb();
const bootstraps = new DrizzleRepoBootstrapRepository(db);
const eventos = new DrizzleSessionEventRepository(db);
const useCase = new AcknowledgeProtectionFailureUseCase(
  bootstraps,
  new AppendSessionEventUseCase(
    new DrizzleUnitOfWork(db),
    new DrizzleSessionRepository(db),
    eventos,
    new DrizzleOutboxRepository(db),
  ),
);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function cenario() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-ack', email: 'ack@brabo.dev' })
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
  const [session] = await db
    .insert(sessions)
    .values({ projectId: project.id, createdBy: user.id })
    .returning();

  await bootstraps.create({ projectId: project.id, sessionId: session.id });

  return { user, project, session };
}

const falharEm = (projectId: string, step: 'protect_branches' | 'create_dev_branch') =>
  bootstraps.update(projectId, {
    step,
    status: 'failed',
    attempts: 3,
    lastError: 'Upgrade to GitHub Pro to protect branches on private repos',
  });

describe('AcknowledgeProtectionFailureUseCase', () => {
  it('reconhecer a falha de proteção destrava o projeto', async () => {
    const { user, project } = await cenario();
    await falharEm(project.id, 'protect_branches');

    const r = await useCase.execute(project.id, user.id);

    // `protect_branches` é o ÚLTIMO passo: marcá-lo feito fecha o bootstrap, e
    // é isso que faz o dashboard parar de redirecionar para o provisionamento.
    expect(r.status).toBe('provisioned');
  });

  it('a decisão fica no event log, com quem decidiu e o que foi dispensado', async () => {
    const { user, project, session } = await cenario();
    await falharEm(project.id, 'protect_branches');

    await useCase.execute(project.id, user.id);

    const page = await eventos.listPaginated(session.id, { limit: 50 });
    const ack = page.items.find(
      (e) => e.type === 'bootstrap.step_acknowledged',
    );

    expect(ack).toBeTruthy();
    // O ator é o USUÁRIO: seguir sem proteção é escolha dele, não do bootstrap.
    expect(ack!.actor.kind).toBe('user');
    expect(ack!.actor.id).toBe(user.id);
    // O erro original vai junto — quem ler depois precisa saber o que foi
    // dispensado, não só que algo foi.
    expect(JSON.stringify(ack!.payload)).toContain('GitHub Pro');
  });

  it('falha ANTES da proteção não pode ser reconhecida', async () => {
    // Seguir ali deixaria o projeto sem repositório utilizável — o botão seria
    // uma segunda mentira, em cima da que o achado já denuncia.
    const { user, project } = await cenario();
    await falharEm(project.id, 'create_dev_branch');

    await expect(useCase.execute(project.id, user.id)).rejects.toThrow(
      ConflictException,
    );
  });

  it('a recusa diz POR QUE não dá', async () => {
    const { user, project } = await cenario();
    await falharEm(project.id, 'create_dev_branch');

    await expect(useCase.execute(project.id, user.id)).rejects.toThrow(
      /sem repositório utilizável/,
    );
  });

  it('bootstrap que não falhou não tem o que reconhecer', async () => {
    const { user, project } = await cenario();

    await expect(useCase.execute(project.id, user.id)).rejects.toThrow(
      ConflictException,
    );
  });

  it('projeto sem bootstrap: 404', async () => {
    await expect(
      useCase.execute('00000000-0000-0000-0000-000000000000', 'quem-seja'),
    ).rejects.toThrow(NotFoundException);
  });
});
