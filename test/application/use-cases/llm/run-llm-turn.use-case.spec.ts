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
import { RunLlmTurnUseCase } from '../../../../src/application/use-cases/llm/run-llm-turn.use-case';
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

class ThrowingProvider implements LLMProvider {
  name: LLMProviderName = 'ollama';
  readonly capabilities = { streaming: true, toolCalling: true };
  async *chat(): AsyncGenerator<ChatStreamChunk> {
    await Promise.resolve();
    yield { type: 'text_delta', text: 'parcial' };
    throw new Error('provider caiu');
  }
}

function registryWith(provider: LLMProvider): LLMProviderRegistry {
  return { get: () => provider };
}

function buildUseCase(provider: LLMProvider) {
  return new RunLlmTurnUseCase(
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

async function setup() {
  const [owner] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-turn', email: 'turn@brabo.dev' })
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
      name: 'llama3.2:3b',
      displayName: 'Llama 3.2 3B',
      inputPricePerMillionMicros: 0,
      outputPricePerMillionMicros: 0,
      // Os turnos daqui mandam `tools`, e desde a Fase 9c a cascata recusa
      // candidato sem tool calling quando o turno pede ferramentas.
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

describe('RunLlmTurnUseCase', () => {
  it('caminho feliz: retorna tool_calls, grava token_usage e NÃO grava session_events', async () => {
    const { project, session } = await setup();
    const provider = new FakeProvider([
      { type: 'text_delta', text: 'vou ler ' },
      { type: 'text_delta', text: 'o arquivo' },
      {
        type: 'tool_calls',
        toolCalls: [
          { id: 'tc1', name: 'read_file', arguments: { path: 'README.md' } },
        ],
      },
      { type: 'usage', inputTokens: 12, outputTokens: 4, estimated: false },
    ]);

    const result = await buildUseCase(provider).execute({
      projectId: project.id,
      sessionId: session.id,
      agentId: 'echo',
      messages: [{ role: 'user', content: 'leia o README' }],
      tools: [{ name: 'read_file', description: 'lê arquivo', parameters: {} }],
    });

    expect(result.error).toBeNull();
    expect(result.message.content).toBe('vou ler o arquivo');
    expect(result.message.toolCalls).toEqual([
      { id: 'tc1', name: 'read_file', arguments: { path: 'README.md' } },
    ]);
    expect(result.usage).toMatchObject({
      inputTokens: 12,
      outputTokens: 4,
      estimated: false,
    });
    // Achado do problema 2 (RN-146): o nome do modelo viaja no resultado —
    // antes só existia em `token_usage`, sem vínculo com o turno específico.
    expect(result.modelName).toBe('llama3.2:3b');

    // Metering gravado.
    const usageRows = await db
      .select()
      .from(tokenUsage)
      .where(eq(tokenUsage.sessionId, session.id));
    expect(usageRows).toHaveLength(1);
    expect(usageRows[0]).toMatchObject({
      actorKind: 'agent',
      actorId: 'echo',
      inputTokens: 12,
      outputTokens: 4,
    });

    // NÃO grava session_events (o engine narra o event log).
    const events = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id));
    expect(events).toHaveLength(0);
  });

  it('erro do provider: ainda grava metering estimado e retorna o erro no campo', async () => {
    const { project, session } = await setup();

    const result = await buildUseCase(new ThrowingProvider()).execute({
      projectId: project.id,
      sessionId: session.id,
      agentId: 'echo',
      messages: [{ role: 'user', content: 'oi' }],
    });

    expect(result.error).toContain('provider caiu');
    // Sem usage do provider -> estimativa marcada.
    expect(result.usage.estimated).toBe(true);
    // O modelo já tinha sido resolvido ANTES do provider falhar — o nome
    // viaja mesmo no caminho de erro (RN-146).
    expect(result.modelName).toBe('llama3.2:3b');
    const usageRows = await db
      .select()
      .from(tokenUsage)
      .where(eq(tokenUsage.sessionId, session.id));
    expect(usageRows).toHaveLength(1);
    expect(usageRows[0].estimated).toBe(true);
  });

  it('sem binding de modelo: retorna erro, sem gravar metering', async () => {
    const { project, session } = await setup();
    // Remove o binding pra forçar o erro.
    await db.delete(modelBindings);

    const result = await buildUseCase(new FakeProvider([])).execute({
      projectId: project.id,
      sessionId: session.id,
      messages: [{ role: 'user', content: 'oi' }],
    });

    expect(result.error).toMatch(/modelo vinculado/i);
    // Borda (RN-146): sem binding, nenhum modelo foi resolvido — `modelName`
    // é `null`, nunca undefined nem o nome de um modelo que não existiu.
    expect(result.modelName).toBeNull();
    const usageRows = await db
      .select()
      .from(tokenUsage)
      .where(eq(tokenUsage.sessionId, session.id));
    expect(usageRows).toHaveLength(0);
  });
});
