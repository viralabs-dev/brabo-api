import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  modelBindings,
  models,
  projects,
  sessionEvents,
  sessions,
  tokenUsage,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { DrizzleOutboxRepository } from '../../../../src/infrastructure/persistence/drizzle/outbox.repository';
import { DrizzleModelRepository } from '../../../../src/infrastructure/persistence/drizzle/model.repository';
import { DrizzleModelBindingRepository } from '../../../../src/infrastructure/persistence/drizzle/model-binding.repository';
import { DrizzleUserCredentialRepository } from '../../../../src/infrastructure/persistence/drizzle/user-credential.repository';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { DrizzleBudgetRepository } from '../../../../src/infrastructure/persistence/drizzle/budget.repository';
import { DrizzleTokenUsageRepository } from '../../../../src/infrastructure/persistence/drizzle/token-usage.repository';
import { EnvelopeEncryptionService } from '../../../../src/infrastructure/security/envelope-encryption.service';
import { GptTokenizerEstimator } from '../../../../src/infrastructure/tokenization/gpt-tokenizer-estimator';
import { ResolveModelBindingUseCase } from '../../../../src/application/use-cases/llm/resolve-model-binding.use-case';
import { CheckBudgetGateUseCase } from '../../../../src/application/use-cases/llm/check-budget-gate.use-case';
import { ResolveCredentialOwnerUseCase } from '../../../../src/application/use-cases/llm/resolve-credential-owner.use-case';
import { DrizzleWorkspaceRepository } from '../../../../src/infrastructure/persistence/drizzle/workspace.repository';
import { RecordLlmUsageUseCase } from '../../../../src/application/use-cases/llm/record-llm-usage.use-case';
import {
  StreamLlmTurnUseCase,
  type LlmTurnStreamEvent,
} from '../../../../src/application/use-cases/llm/stream-llm-turn.use-case';
import type { LLMProvider } from '../../../../src/application/ports/llm-provider.port';
import type { LLMProviderRegistry } from '../../../../src/application/ports/llm-provider-registry.port';
import type { ChatStreamChunk, LLMProviderName } from '@brabo/shared';
import { BraboMetrics } from '../../../../src/infrastructure/observability/brabo-metrics';

const { db, pool } = createTestDb();

const unitOfWork = new DrizzleUnitOfWork(db);
const outboxRepo = new DrizzleOutboxRepository(db);
const modelRepo = new DrizzleModelRepository(db);
const bindingRepo = new DrizzleModelBindingRepository(db);
const credentialRepo = new DrizzleUserCredentialRepository(db);
const projectRepo = new DrizzleProjectRepository(db);
const budgetRepo = new DrizzleBudgetRepository(db);
const tokenUsageRepo = new DrizzleTokenUsageRepository(db);
const encryption = new EnvelopeEncryptionService();
const tokenEstimator = new GptTokenizerEstimator();

const resolveModelBinding = new ResolveModelBindingUseCase(
  bindingRepo,
  projectRepo,
);
const checkBudgetGate = new CheckBudgetGateUseCase(budgetRepo);
const resolveCredentialOwner = new ResolveCredentialOwnerUseCase(
  projectRepo,
  new DrizzleWorkspaceRepository(db),
);
const recordLlmUsage = new RecordLlmUsageUseCase(
  tokenUsageRepo,
  budgetRepo,
  outboxRepo,
  // Registry próprio por spec: prom-client é global por default e
  // contadores vazados entre arquivos tornariam as asserções dependentes
  // da ordem de execução.
  new BraboMetrics(),
);

class FakeProvider implements LLMProvider {
  name: LLMProviderName = 'ollama';
  readonly capabilities = { streaming: true, toolCalling: true };
  constructor(private readonly script: ChatStreamChunk[]) {}
  async *chat(): AsyncGenerator<ChatStreamChunk> {
    await Promise.resolve();
    for (const chunk of this.script) yield chunk;
  }
}

function registryWith(provider: LLMProvider): LLMProviderRegistry {
  return { get: () => provider };
}

function buildUseCase(provider: LLMProvider) {
  return new StreamLlmTurnUseCase(
    unitOfWork,
    modelRepo,
    credentialRepo,
    encryption,
    registryWith(provider),
    tokenEstimator,
    resolveModelBinding,
    checkBudgetGate,
    recordLlmUsage,
    resolveCredentialOwner,
  );
}

async function coletar(
  gen: AsyncGenerator<LlmTurnStreamEvent>,
): Promise<LlmTurnStreamEvent[]> {
  const eventos: LlmTurnStreamEvent[] = [];
  for await (const evento of gen) eventos.push(evento);
  return eventos;
}

async function setup() {
  const [owner] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-stream-turn', email: 'stream-turn@brabo.dev' })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'acme-stream', slug: 'acme-stream', createdBy: owner.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'core',
      slug: 'core',
      createdBy: owner.id,
    })
    .returning();
  const [session] = await db
    .insert(sessions)
    .values({ projectId: project.id, createdBy: owner.id })
    .returning();
  const [model] = await db
    .insert(models)
    .values({
      provider: 'ollama',
      name: 'llama3.2:3b',
      displayName: 'Llama 3.2 3B',
      inputPricePerMillionMicros: 0,
      outputPricePerMillionMicros: 0,
      supportsToolCalling: true,
    })
    .returning();
  await bindingRepo.upsert({
    scope: 'workspace',
    scopeId: workspace.id,
    modelId: model.id,
    createdBy: owner.id,
  });
  return { owner, workspace, project, session, model };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('StreamLlmTurnUseCase', () => {
  it('caminho feliz: o frame final carrega o nome do modelo (RN-146)', async () => {
    const { project, session } = await setup();
    const provider = new FakeProvider([
      { type: 'text_delta', text: 'Oi! ' },
      { type: 'text_delta', text: 'tudo bem?' },
      { type: 'usage', inputTokens: 10, outputTokens: 3, estimated: false },
    ]);

    const eventos = await coletar(
      buildUseCase(provider).execute({
        projectId: project.id,
        sessionId: session.id,
        agentId: 'criativo',
        messages: [{ role: 'user', content: 'oi' }],
      }),
    );

    const final = eventos.at(-1);
    if (final?.type !== 'final') throw new Error('esperava um frame final');

    expect(final.error).toBeNull();
    expect(final.message.content).toBe('Oi! tudo bem?');
    // Achado do problema 2 — antes o nome do modelo só existia em
    // `token_usage`, sem vínculo com o `agent.response` específico.
    expect(final.modelName).toBe('llama3.2:3b');

    const usageRows = await db
      .select()
      .from(tokenUsage)
      .where(eq(tokenUsage.sessionId, session.id));
    expect(usageRows).toHaveLength(1);

    // NÃO grava session_events (o engine narra o event log).
    const events = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id));
    expect(events).toHaveLength(0);
  });

  it('borda: sem binding de modelo, o frame final vem com modelName nulo', async () => {
    const { project, session } = await setup();
    await db.delete(modelBindings);

    const eventos = await coletar(
      buildUseCase(new FakeProvider([])).execute({
        projectId: project.id,
        sessionId: session.id,
        agentId: 'criativo',
        messages: [{ role: 'user', content: 'oi' }],
      }),
    );

    const final = eventos.at(-1);
    if (final?.type !== 'final') throw new Error('esperava um frame final');

    expect(final.error).toMatch(/modelo vinculado/i);
    expect(final.modelName).toBeNull();
  });
});
