import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  automacoesDoProjeto,
  projects,
  sessions,
  users,
  workspaceMembers,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { DrizzleSessionRepository } from '../../../../src/infrastructure/persistence/drizzle/session.repository';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { DrizzleWorkspaceRepository } from '../../../../src/infrastructure/persistence/drizzle/workspace.repository';
import { DrizzleProposedActionRepository } from '../../../../src/infrastructure/persistence/drizzle/proposed-action.repository';
import { DrizzleAgentAutonomyRepository } from '../../../../src/infrastructure/persistence/drizzle/agent-autonomy.repository';
import { DrizzleOutboxRepository } from '../../../../src/infrastructure/persistence/drizzle/outbox.repository';
import { DrizzleSessionEventRepository } from '../../../../src/infrastructure/persistence/drizzle/session-event.repository';
import { DrizzleContainerRepository } from '../../../../src/infrastructure/persistence/drizzle/container.repository';
import { DrizzleAutomacaoDoProjetoRepository } from '../../../../src/infrastructure/persistence/drizzle/automacao-do-projeto.repository';
import { DrizzleProvisionedRepositoryRepository } from '../../../../src/infrastructure/persistence/drizzle/provisioned-repository.repository';
import { DrizzleGitConnectionRepository } from '../../../../src/infrastructure/persistence/drizzle/git-connection.repository';
import { FsPermissionsFileStore } from '../../../../src/infrastructure/filesystem/fs-permissions-file-store';
import { ResolveEffectiveRoleUseCase } from '../../../../src/application/use-cases/iam/resolve-effective-role.use-case';
import { AutomacoesDoProjetoUseCase } from '../../../../src/application/use-cases/iam/automacoes-do-projeto.use-case';
import { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import { ObterCicloDeVidaDoContainerUseCase } from '../../../../src/application/use-cases/containers/obter-ciclo-de-vida-do-container.use-case';
import { ProposeActionUseCase } from '../../../../src/application/use-cases/actions/propose-action.use-case';
import { ApproveActionUseCase } from '../../../../src/application/use-cases/actions/approve-action.use-case';
import { DenyActionUseCase } from '../../../../src/application/use-cases/actions/deny-action.use-case';
import { OferecerAutomacaoUseCase } from '../../../../src/application/use-cases/automacao/oferecer-automacao.use-case';
import { BraboMetrics } from '../../../../src/infrastructure/observability/brabo-metrics';

/**
 * AT-998 (RN-1435..RN-1438) de ponta a ponta com o banco: 3 aprovações iguais
 * oferecem; aceitar faz a próxima sair `auto_approved`; desfazer volta a pedir;
 * recusar faz a oferta não voltar; a recusa no meio zera a contagem.
 */
const { db, pool } = createTestDb();
const unitOfWork = new DrizzleUnitOfWork(db);
const sessionRepo = new DrizzleSessionRepository(db);
const projectRepo = new DrizzleProjectRepository(db);
const proposedActionRepo = new DrizzleProposedActionRepository(db);
const outboxRepo = new DrizzleOutboxRepository(db);
const eventRepo = new DrizzleSessionEventRepository(db);
const appendEvent = new AppendSessionEventUseCase(
  unitOfWork,
  sessionRepo,
  eventRepo,
  outboxRepo,
);
const automacoes = new AutomacoesDoProjetoUseCase(
  new DrizzleAutomacaoDoProjetoRepository(db),
);
const ofertas = new OferecerAutomacaoUseCase(
  eventRepo,
  appendEvent,
  automacoes,
  new DrizzleProvisionedRepositoryRepository(db),
  new DrizzleGitConnectionRepository(db),
);
const passthrough = {
  execute: (_p: string, _s: string, a: unknown) => Promise.resolve(a),
} as never;

const propose = new ProposeActionUseCase(
  unitOfWork,
  sessionRepo,
  projectRepo,
  proposedActionRepo,
  new DrizzleAgentAutonomyRepository(db),
  new FsPermissionsFileStore(),
  outboxRepo,
  new ResolveEffectiveRoleUseCase(
    projectRepo,
    new DrizzleWorkspaceRepository(db),
  ),
  undefined as never,
  undefined as never,
  undefined as never,
  passthrough, // executeContainerStart
  undefined as never,
  undefined as never,
  appendEvent,
  new ObterCicloDeVidaDoContainerUseCase(new DrizzleContainerRepository(db)),
  { configurado: () => true } as never,
  undefined as never,
  undefined,
  ofertas,
);
const approve = new ApproveActionUseCase(
  unitOfWork,
  sessionRepo,
  proposedActionRepo,
  outboxRepo,
  undefined as never,
  undefined as never,
  undefined as never,
  passthrough, // executeContainerStart
  undefined as never,
  undefined as never,
  undefined as never,
  passthrough,
  undefined as never,
  undefined as never,
  undefined as never,
  new BraboMetrics(),
  appendEvent,
  undefined as never,
  undefined as never,
  undefined,
  undefined,
  ofertas,
);
const deny = new DenyActionUseCase(
  unitOfWork,
  sessionRepo,
  proposedActionRepo,
  outboxRepo,
  new BraboMetrics(),
  appendEvent,
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
    .values({ keycloakSub: 'sub-oferta', email: 'oferta@brabo.dev' })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: user.id })
    .returning();
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: ws.id, userId: user.id, role: 'owner' });
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: ws.id,
      name: 'core',
      slug: 'core',
      createdBy: user.id,
    })
    .returning();
  const [session] = await db
    .insert(sessions)
    .values({ projectId: project.id, createdBy: user.id })
    .returning();
  const proporEAprovar = async () => {
    const a = await propose.execute(project.id, session.id, {
      actionType: 'container_start',
      actor: { kind: 'agent', id: 'infra' },
      payload: {},
    });
    await approve.execute(project.id, session.id, a.id, user.id);
    return a;
  };
  const eventos = async (tipo: string) =>
    eventRepo.listByTypeForProject(project.id, tipo);
  const oferta = {
    categoria: 'aprovacao' as const,
    chave: 'container_start',
    escopo: 'infra',
  };
  return { user, project, session, proporEAprovar, eventos, oferta };
}

describe('OferecerAutomacaoUseCase (AT-998)', () => {
  it('3 aprovações iguais oferecem; aceitar faz a 4ª sair auto_approved; desfazer volta a pedir', async () => {
    const { user, project, session, proporEAprovar, eventos, oferta } =
      await cenario();
    await proporEAprovar();
    await proporEAprovar();
    expect(await eventos('automacao.oferecida')).toHaveLength(0);
    await proporEAprovar();
    const oferecidas = await eventos('automacao.oferecida');
    expect(oferecidas).toHaveLength(1);
    expect(oferecidas[0].payload).toMatchObject({ ...oferta, n: 3 });

    // sem aceitar, a 4ª ainda pede.
    const antes = await propose.execute(project.id, session.id, {
      actionType: 'container_start',
      actor: { kind: 'agent', id: 'infra' },
      payload: {},
    });
    expect(antes.status).toBe('pending');

    await ofertas.responder(project.id, user.id, {
      ...oferta,
      decisao: 'aceitar',
    });
    expect(await eventos('automacao.aceita')).toHaveLength(1);
    const regra = (await automacoes.listar(project.id)).find(
      (r) => r.categoria === 'aprovacao',
    );
    expect(regra).toMatchObject({
      chave: 'container_start@infra',
      origem: 'oferta',
      ligada: true,
    });

    const quarta = await propose.execute(project.id, session.id, {
      actionType: 'container_start',
      actor: { kind: 'agent', id: 'infra' },
      payload: {},
    });
    expect(quarta.status).toBe('auto_approved');
    const aplicadas = await eventos('automacao.aplicada');
    expect(aplicadas).toHaveLength(1);
    expect(aplicadas[0].payload).toMatchObject({
      actionType: 'container_start',
      agente: 'infra',
    });

    // outro agente não herda a regra.
    const outro = await propose.execute(project.id, session.id, {
      actionType: 'container_start',
      actor: { kind: 'agent', id: 'dev-lead' },
      payload: {},
    });
    expect(outro.status).toBe('pending');

    await automacoes.definir(
      project.id,
      user.id,
      'aprovacao',
      'container_start@infra',
      false,
    );
    const quinta = await propose.execute(project.id, session.id, {
      actionType: 'container_start',
      actor: { kind: 'agent', id: 'infra' },
      payload: {},
    });
    expect(quinta.status).toBe('pending');
  });

  it('a recusa no meio zera a contagem', async () => {
    const { user, project, session, proporEAprovar, eventos } = await cenario();
    await proporEAprovar();
    await proporEAprovar();
    const a = await propose.execute(project.id, session.id, {
      actionType: 'container_start',
      actor: { kind: 'agent', id: 'infra' },
      payload: {},
    });
    await deny.execute(project.id, session.id, a.id, user.id);
    await proporEAprovar();
    expect(await eventos('automacao.oferecida')).toHaveLength(0);
  });

  it('oferta recusada não volta, e responder duas vezes é 409', async () => {
    const { user, project, proporEAprovar, eventos, oferta } = await cenario();
    for (let i = 0; i < 3; i++) await proporEAprovar();
    await ofertas.responder(project.id, user.id, {
      ...oferta,
      decisao: 'recusar',
    });
    expect(await eventos('automacao.recusada')).toHaveLength(1);
    expect(await db.select().from(automacoesDoProjeto)).toHaveLength(0);
    await proporEAprovar();
    await proporEAprovar();
    expect(await eventos('automacao.oferecida')).toHaveLength(1);
    await expect(
      ofertas.responder(project.id, user.id, { ...oferta, decisao: 'aceitar' }),
    ).rejects.toThrow('já foi respondida');
  });

  it('responder uma oferta que não existe é 404', async () => {
    const { user, project, oferta } = await cenario();
    await expect(
      ofertas.responder(project.id, user.id, { ...oferta, decisao: 'aceitar' }),
    ).rejects.toThrow('não existe');
  });

  it('desbloqueio: a regra vale uma vez por tarefa (anti-laço)', async () => {
    const { user, project, session } = await cenario();
    await automacoes.gravarRegraDaOferta(
      project.id,
      user.id,
      'desbloqueio',
      'falhou # vezes',
    );
    expect(
      await ofertas.regraDoDesbloqueio(project.id, 't1', 'Falhou 7 vezes'),
    ).toMatchObject({ chave: 'falhou # vezes' });
    expect(
      await ofertas.regraDoDesbloqueio(project.id, 't1', 'Outro motivo'),
    ).toBeNull();
    await appendEvent.execute(project.id, session.id, {
      type: 'backlog.task_unblocked',
      actor: { kind: 'system', id: 'automacao-oferta' },
      payload: { taskId: 't1', automacao: true },
    });
    expect(
      await ofertas.regraDoDesbloqueio(project.id, 't1', 'Falhou 9 vezes'),
    ).toBeNull();
    expect(
      await ofertas.regraDoDesbloqueio(project.id, 't2', 'Falhou 9 vezes'),
    ).not.toBeNull();
  });
});
