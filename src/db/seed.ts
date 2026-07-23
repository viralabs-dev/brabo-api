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
import {
  ModelRepository,
  type ModelInput,
} from '../application/ports/model-repository.port';
import type { Model } from '../domain/llm/model.entity';
import { SetModelBindingUseCase } from '../application/use-cases/llm/set-model-binding.use-case';

// Preços aproximados de mercado (micro-USD por 1M tokens) — editáveis
// depois (ver README: "models" não tem endpoint HTTP de edição na
// Fase 1, corrija aqui ou via SQL direto).
const MODEL_SEEDS: ModelInput[] = [
  {
    provider: 'ollama',
    name: 'llama3.2:1b',
    displayName: 'Llama 3.2 1B (local)',
    inputPricePerMillionMicros: 0,
    outputPricePerMillionMicros: 0,
  },
  {
    provider: 'anthropic',
    name: 'claude-opus-4-8',
    displayName: 'Claude Opus 4.8',
    inputPricePerMillionMicros: 5_000_000,
    outputPricePerMillionMicros: 25_000_000,
  },
  {
    provider: 'anthropic',
    name: 'claude-sonnet-5',
    displayName: 'Claude Sonnet 5',
    inputPricePerMillionMicros: 3_000_000,
    outputPricePerMillionMicros: 15_000_000,
  },
  {
    provider: 'anthropic',
    name: 'claude-haiku-4-5-20251001',
    displayName: 'Claude Haiku 4.5',
    inputPricePerMillionMicros: 1_000_000,
    outputPricePerMillionMicros: 5_000_000,
  },
  {
    provider: 'openai',
    name: 'gpt-4o',
    displayName: 'GPT-4o',
    inputPricePerMillionMicros: 2_500_000,
    outputPricePerMillionMicros: 10_000_000,
  },
  {
    provider: 'openai',
    name: 'gpt-4o-mini',
    displayName: 'GPT-4o mini',
    inputPricePerMillionMicros: 150_000,
    outputPricePerMillionMicros: 600_000,
  },
];

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
  const models = app.get(ModelRepository);
  const setModelBinding = app.get(SetModelBindingUseCase);

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

  let localModel: Model | undefined;
  for (const modelSeed of MODEL_SEEDS) {
    const model = await models.upsertByProviderAndName(modelSeed);
    console.log(`✓ modelo: ${model.provider}/${model.name}`);
    if (model.provider === 'ollama') localModel = model;
  }
  if (!localModel) throw new Error('Modelo local não foi semeado');

  await setModelBinding.execute(
    'workspace',
    workspace.id,
    localModel.id,
    owner.id,
  );
  console.log(
    `✓ binding: workspace ${workspace.slug} -> ${localModel.provider}/${localModel.name}`,
  );

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
  console.log(
    `\nPra testar o chat via curl (Ollama, projeto+sessão do seed):\n` +
      `curl -N -X POST http://localhost:3000/projects/${project.id}/sessions/${session.id}/chat \\\n` +
      `  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\\n` +
      `  -d '{"text":"oi"}'`,
  );
  await app.close();
}

main().catch((error) => {
  console.error('Seed falhou:', error);
  process.exit(1);
});
