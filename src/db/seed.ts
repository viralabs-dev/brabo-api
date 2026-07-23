/**
 * Seed de demonstração: 1 workspace, 2 usuários com papéis distintos,
 * 1 projeto e 1 sessão com 5 eventos.
 *
 * Roda os use cases reais via um application context do Nest (sem
 * HTTP, sem guards — guards só interceptam a pipeline HTTP) para
 * exercitar o mesmo caminho de código usado pela API (outbox incluso).
 *
 * Uso: pnpm --filter api seed
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { SyncUserUseCase } from '../application/use-cases/iam/sync-user.use-case';
import { CreateWorkspaceUseCase } from '../application/use-cases/iam/create-workspace.use-case';
import { AddWorkspaceMemberUseCase } from '../application/use-cases/iam/add-workspace-member.use-case';
import { CreateProjectUseCase } from '../application/use-cases/iam/create-project.use-case';
import { CreateSessionUseCase } from '../application/use-cases/sessions/create-session.use-case';
import { TransitionSessionUseCase } from '../application/use-cases/sessions/transition-session.use-case';
import { AppendSessionEventUseCase } from '../application/use-cases/sessions/append-session-event.use-case';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const syncUser = app.get(SyncUserUseCase);
  const createWorkspace = app.get(CreateWorkspaceUseCase);
  const addWorkspaceMember = app.get(AddWorkspaceMemberUseCase);
  const createProject = app.get(CreateProjectUseCase);
  const createSession = app.get(CreateSessionUseCase);
  const transitionSession = app.get(TransitionSessionUseCase);
  const appendSessionEvent = app.get(AppendSessionEventUseCase);

  const owner = await syncUser.execute({
    keycloakSub: 'seed-owner',
    email: 'owner@brabo.dev',
    name: 'Dona da Casa',
  });
  const developer = await syncUser.execute({
    keycloakSub: 'seed-developer',
    email: 'dev@brabo.dev',
    name: 'Dev Sênior',
  });
  console.log(
    `✓ usuários: ${owner.email} (owner), ${developer.email} (developer)`,
  );

  const workspace = await createWorkspace.execute(owner.id, {
    name: 'Acme Corp',
    slug: 'acme-corp',
  });
  await addWorkspaceMember.execute(workspace.id, developer.id, 'developer');
  console.log(`✓ workspace: ${workspace.name} (${workspace.slug})`);

  const project = await createProject.execute(workspace.id, owner.id, {
    name: 'Core API',
    slug: 'core-api',
  });
  console.log(`✓ projeto: ${project.name} (${project.slug})`);

  const session = await createSession.execute(project.id, developer.id);
  console.log(`✓ sessão criada: ${session.id} (status=${session.status})`);

  await transitionSession.execute(project.id, session.id, 'active');
  console.log('✓ sessão ativada');

  const eventInputs = [
    {
      type: 'session.activated',
      actor: { kind: 'system' as const, id: 'system' },
      payload: {},
    },
    {
      type: 'chat.message',
      actor: { kind: 'user' as const, id: developer.id },
      payload: { text: 'bora começar a análise do ticket #42' },
    },
    {
      type: 'agent.response',
      actor: { kind: 'agent' as const, id: 'arquiteto' },
      payload: { text: 'levantando requisitos...' },
    },
    {
      type: 'chat.message',
      actor: { kind: 'user' as const, id: developer.id },
      payload: { text: 'beleza, me avisa quando tiver o esboço' },
    },
    {
      type: 'agent.response',
      actor: { kind: 'agent' as const, id: 'arquiteto' },
      payload: { text: 'esboço pronto, aguardando revisão' },
    },
  ];

  for (const input of eventInputs) {
    const event = await appendSessionEvent.execute(
      project.id,
      session.id,
      input,
    );
    console.log(`✓ evento #${event.seq}: ${event.type}`);
  }

  console.log('\nSeed concluído.');
  await app.close();
}

main().catch((error) => {
  console.error('Seed falhou:', error);
  process.exit(1);
});
