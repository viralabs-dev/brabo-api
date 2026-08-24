import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  models,
  outboxEvents,
  projects,
  sessionEvents,
  sessions,
  tokenUsage,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { DrizzleSessionRepository } from '../../../../src/infrastructure/persistence/drizzle/session.repository';
import { DrizzleSessionEventRepository } from '../../../../src/infrastructure/persistence/drizzle/session-event.repository';
import { DrizzleOutboxRepository } from '../../../../src/infrastructure/persistence/drizzle/outbox.repository';
import { DrizzleModelRepository } from '../../../../src/infrastructure/persistence/drizzle/model.repository';
import { DrizzleModelBindingRepository } from '../../../../src/infrastructure/persistence/drizzle/model-binding.repository';
import { DrizzleUserCredentialRepository } from '../../../../src/infrastructure/persistence/drizzle/user-credential.repository';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { DrizzleBudgetRepository } from '../../../../src/infrastructure/persistence/drizzle/budget.repository';
import { DrizzleAgentAreaRepository } from '../../../../src/infrastructure/persistence/drizzle/agent-area.repository';
import { DrizzleTokenUsageRepository } from '../../../../src/infrastructure/persistence/drizzle/token-usage.repository';
import { EnvelopeEncryptionService } from '../../../../src/infrastructure/security/envelope-encryption.service';
import { GptTokenizerEstimator } from '../../../../src/infrastructure/tokenization/gpt-tokenizer-estimator';
import { ResolveModelBindingUseCase } from '../../../../src/application/use-cases/llm/resolve-model-binding.use-case';
import { CheckBudgetGateUseCase } from '../../../../src/application/use-cases/llm/check-budget-gate.use-case';
import { RecordLlmUsageUseCase } from '../../../../src/application/use-cases/llm/record-llm-usage.use-case';
import { SendChatMessageUseCase } from '../../../../src/application/use-cases/llm/send-chat-message.use-case';
import type { LLMProvider } from '../../../../src/application/ports/llm-provider.port';
import type { LLMProviderRegistry } from '../../../../src/application/ports/llm-provider-registry.port';
import type { ChatStreamChunk, LLMProviderName } from '@brabo/shared';
import { BraboMetrics } from '../../../../src/infrastructure/observability/brabo-metrics';

const { db, pool } = createTestDb();

const unitOfWork = new DrizzleUnitOfWork(db);
const sessionRepo = new DrizzleSessionRepository(db);
const sessionEventRepo = new DrizzleSessionEventRepository(db);
const outboxRepo = new DrizzleOutboxRepository(db);
const modelRepo = new DrizzleModelRepository(db);
const bindingRepo = new DrizzleModelBindingRepository(db);
const credentialRepo = new DrizzleUserCredentialRepository(db);
const projectRepo = new DrizzleProjectRepository(db);
const budgetRepo = new DrizzleBudgetRepository(db);
const areaRepo = new DrizzleAgentAreaRepository(db);
const tokenUsageRepo = new DrizzleTokenUsageRepository(db);
const encryption = new EnvelopeEncryptionService();
const tokenEstimator = new GptTokenizerEstimator();

const resolveModelBinding = new ResolveModelBindingUseCase(
  bindingRepo,
  projectRepo,
);
const checkBudgetGate = new CheckBudgetGateUseCase(budgetRepo, areaRepo);
const recordLlmUsage = new RecordLlmUsageUseCase(
  tokenUsageRepo,
  budgetRepo,
  areaRepo,
  outboxRepo,
  // Registry próprio por spec: prom-client é global por default e
  // contadores vazados entre arquivos tornariam as asserções dependentes
  // da ordem de execução.
  new BraboMetrics(),
);

class FakeProvider implements LLMProvider {
  name: LLMProviderName = 'ollama';
  readonly capabilities = {
    streaming: true,
    toolCalling: true,
    listModels: false,
    embeddings: false,
  };
  callCount = 0;

  constructor(private readonly script: ChatStreamChunk[]) {}

  async *chat(): AsyncGenerator<ChatStreamChunk> {
    this.callCount += 1;
    await Promise.resolve();
    for (const chunk of this.script) {
      yield chunk;
    }
  }
}

class ThrowingProvider implements LLMProvider {
  name: LLMProviderName = 'anthropic';
  readonly capabilities = {
    streaming: true,
    toolCalling: true,
    listModels: false,
    embeddings: false,
  };
  callCount = 0;

  async *chat(): AsyncGenerator<ChatStreamChunk> {
    this.callCount += 1;
    await Promise.resolve();
    yield { type: 'text_delta', text: 'começando a resp' };
    throw new Error('provider caiu no meio do stream');
  }
}

function registryWith(provider: LLMProvider): LLMProviderRegistry {
  return { get: () => provider };
}

async function setup() {
  const [owner] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-chat', email: 'chat@brabo.dev' })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: owner.id })
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
      name: 'llama3.2:1b',
      displayName: 'Llama 3.2 1B',
      inputPricePerMillionMicros: 0,
      outputPricePerMillionMicros: 0,
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

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) items.push(item);
  return items;
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('SendChatMessageUseCase', () => {
  it('caminho feliz: grava mensagem+resposta no event log e token_usage com custo', async () => {
    const { project, session, owner, model } = await setup();
    const provider = new FakeProvider([
      { type: 'text_delta', text: 'Olá! ' },
      { type: 'text_delta', text: 'tudo bem?' },
      { type: 'usage', inputTokens: 10, outputTokens: 5, estimated: false },
    ]);

    const useCase = new SendChatMessageUseCase(
      unitOfWork,
      sessionRepo,
      sessionEventRepo,
      outboxRepo,
      modelRepo,
      credentialRepo,
      encryption,
      registryWith(provider),
      tokenEstimator,
      resolveModelBinding,
      checkBudgetGate,
      recordLlmUsage,
    );

    const events = await collect(
      useCase.execute({
        projectId: project.id,
        sessionId: session.id,
        actor: { kind: 'user', id: owner.id },
        text: 'oi',
      }),
    );

    expect(events.filter((e) => e.type === 'delta')).toHaveLength(2);
    const done = events.find((e) => e.type === 'done');
    expect(done).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
      costMicros: 0,
      estimated: false,
    });

    const storedEvents = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id))
      .orderBy(asc(sessionEvents.seq));
    expect(storedEvents.map((e) => e.type)).toEqual([
      'chat.message',
      'agent.response',
    ]);
    // RN-175: o `agent.response` diz QUAL modelo respondeu. O ator já é o
    // nome do modelo neste caminho (chat sem agente ativo), mas a tela lê o
    // PAYLOAD — e é ele que continua valendo se um dia este caminho ganhar
    // um agente de verdade.
    expect(storedEvents[1].payload).toMatchObject({
      text: 'Olá! tudo bem?',
      modelName: model.name,
    });

    const usageRows = await db
      .select()
      .from(tokenUsage)
      .where(eq(tokenUsage.sessionId, session.id));
    expect(usageRows).toHaveLength(1);
    expect(usageRows[0].modelId).toBe(model.id);
  });

  it('bloqueio em 100%: provider nunca é chamado', async () => {
    const { project, session, owner } = await setup();
    const budget = await budgetRepo.upsertForProject(project.id, {
      limitMicros: 1000,
      policy: 'block',
    });
    await budgetRepo.incrementSpent(budget.id, 1000);

    const provider = new FakeProvider([
      { type: 'text_delta', text: 'não deveria chegar aqui' },
    ]);
    const useCase = new SendChatMessageUseCase(
      unitOfWork,
      sessionRepo,
      sessionEventRepo,
      outboxRepo,
      modelRepo,
      credentialRepo,
      encryption,
      registryWith(provider),
      tokenEstimator,
      resolveModelBinding,
      checkBudgetGate,
      recordLlmUsage,
    );

    const events = await collect(
      useCase.execute({
        projectId: project.id,
        sessionId: session.id,
        actor: { kind: 'user', id: owner.id },
        text: 'oi',
      }),
    );

    expect(provider.callCount).toBe(0);
    expect(events).toEqual([
      { type: 'error', message: 'Budget do projeto atingiu o limite' },
    ]);

    const usageRows = await db
      .select()
      .from(tokenUsage)
      .where(eq(tokenUsage.sessionId, session.id));
    expect(usageRows).toHaveLength(0);
  });

  it('erro do provider no meio do stream: usa fallback estimado e registra o erro no event log', async () => {
    const { project, session, owner } = await setup();
    const provider = new ThrowingProvider();

    const useCase = new SendChatMessageUseCase(
      unitOfWork,
      sessionRepo,
      sessionEventRepo,
      outboxRepo,
      modelRepo,
      credentialRepo,
      encryption,
      registryWith(provider),
      tokenEstimator,
      resolveModelBinding,
      checkBudgetGate,
      recordLlmUsage,
    );

    const events = await collect(
      useCase.execute({
        projectId: project.id,
        sessionId: session.id,
        actor: { kind: 'user', id: owner.id },
        text: 'oi',
      }),
    );

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent?.message).toMatch(/provider caiu no meio do stream/);

    const storedEvents = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id))
      .orderBy(asc(sessionEvents.seq));
    expect(storedEvents).toHaveLength(2);
    expect(storedEvents[1].payload).toMatchObject({
      error: 'provider caiu no meio do stream',
    });

    const usageRows = await db
      .select()
      .from(tokenUsage)
      .where(eq(tokenUsage.sessionId, session.id));
    expect(usageRows[0].estimated).toBe(true);
  });

  it('credencial nunca aparece em payloads persistidos nem em logs', async () => {
    const { project, session, owner } = await setup();
    const plaintextKey = 'sk-ant-super-secreta-nao-pode-vazar';

    // Vincula a sessão a um modelo cloud com credencial cadastrada.
    const [cloudModel] = await db
      .insert(models)
      .values({
        provider: 'anthropic',
        name: 'claude-sonnet-5',
        displayName: 'Claude Sonnet 5',
        inputPricePerMillionMicros: 3_000_000,
        outputPricePerMillionMicros: 15_000_000,
      })
      .returning();
    await bindingRepo.upsert({
      scope: 'session',
      scopeId: session.id,
      modelId: cloudModel.id,
      createdBy: owner.id,
    });
    const secret = encryption.encrypt(plaintextKey);
    await credentialRepo.upsert(owner.id, 'anthropic', secret);

    const provider = new FakeProvider([
      { type: 'text_delta', text: 'resposta' },
      { type: 'usage', inputTokens: 3, outputTokens: 2, estimated: false },
    ]);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const useCase = new SendChatMessageUseCase(
      unitOfWork,
      sessionRepo,
      sessionEventRepo,
      outboxRepo,
      modelRepo,
      credentialRepo,
      encryption,
      registryWith(provider),
      tokenEstimator,
      resolveModelBinding,
      checkBudgetGate,
      recordLlmUsage,
    );

    await collect(
      useCase.execute({
        projectId: project.id,
        sessionId: session.id,
        actor: { kind: 'user', id: owner.id },
        text: 'oi',
      }),
    );

    const allLoggedArgs = [
      ...logSpy.mock.calls,
      ...errorSpy.mock.calls,
      ...warnSpy.mock.calls,
    ]
      .flat()
      .map((arg) => JSON.stringify(arg));
    expect(allLoggedArgs.join('\n')).not.toContain(plaintextKey);
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();

    const storedEvents = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id));
    expect(JSON.stringify(storedEvents)).not.toContain(plaintextKey);

    const outboxRows = await db.select().from(outboxEvents);
    expect(JSON.stringify(outboxRows)).not.toContain(plaintextKey);

    const usageRows = await db
      .select()
      .from(tokenUsage)
      .where(eq(tokenUsage.sessionId, session.id));
    expect(JSON.stringify(usageRows)).not.toContain(plaintextKey);
  });
});
