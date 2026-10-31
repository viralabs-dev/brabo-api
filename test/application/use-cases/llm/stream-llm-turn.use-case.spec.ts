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
import { DrizzleAgentAreaRepository } from '../../../../src/infrastructure/persistence/drizzle/agent-area.repository';
import { DrizzleTokenUsageRepository } from '../../../../src/infrastructure/persistence/drizzle/token-usage.repository';
import { EnvelopeEncryptionService } from '../../../../src/infrastructure/security/envelope-encryption.service';
import { GptTokenizerEstimator } from '../../../../src/infrastructure/tokenization/gpt-tokenizer-estimator';
import { ResolveModelBindingUseCase } from '../../../../src/application/use-cases/llm/resolve-model-binding.use-case';
import { CheckBudgetGateUseCase } from '../../../../src/application/use-cases/llm/check-budget-gate.use-case';
import { ResolveCredentialOwnerUseCase } from '../../../../src/application/use-cases/llm/resolve-credential-owner.use-case';
import { DrizzleWorkspaceRepository } from '../../../../src/infrastructure/persistence/drizzle/workspace.repository';
import { DecidirFerramentaDoPassoUseCase } from '../../../../src/application/use-cases/llm/decidir-ferramenta-do-passo.use-case';
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
const areaRepo = new DrizzleAgentAreaRepository(db);
const tokenUsageRepo = new DrizzleTokenUsageRepository(db);
const encryption = new EnvelopeEncryptionService();
const tokenEstimator = new GptTokenizerEstimator();

const resolveModelBinding = new ResolveModelBindingUseCase(
  bindingRepo,
  projectRepo,
);
const checkBudgetGate = new CheckBudgetGateUseCase(budgetRepo, areaRepo);
const resolveCredentialOwner = new ResolveCredentialOwnerUseCase(
  projectRepo,
  new DrizzleWorkspaceRepository(db),
);
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

// Provider `ollama` nestes specs: o roteador nunca é consultado (só com
// OpenRouter, ADR 0179). Se fosse, o Jev de mentira derrubaria o teste.
const decidirFerramenta = new DecidirFerramentaDoPassoUseCase(
  projectRepo,
  new DrizzleWorkspaceRepository(db),
  {
    decidir: () => {
      throw new Error('o Jev não deve ser chamado com provider != openrouter');
    },
  },
  tokenEstimator,
  unitOfWork,
  recordLlmUsage,
);

class FakeProvider implements LLMProvider {
  name: LLMProviderName = 'ollama';
  readonly capabilities = {
    streaming: true,
    toolCalling: true,
    listModels: false,
    embeddings: false,
    routingPreference: false,
    stickySession: false,
    priceCeiling: false,
    promptCaching: false,
  };
  constructor(private readonly script: ChatStreamChunk[]) {}
  recebidas: unknown[] = [];
  async *chat(
    _m?: unknown,
    options?: unknown,
  ): AsyncGenerator<ChatStreamChunk> {
    await Promise.resolve();
    this.recebidas.push(options);
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
    decidirFerramenta,
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
  it('a chave de sessão do agente vai ao provider (ADR 0221, RN-907): com e sem agentId', async () => {
    const { project, session } = await setup();
    const provider = new FakeProvider([
      { type: 'usage', inputTokens: 1, outputTokens: 1, estimated: false },
    ]);
    const base = {
      projectId: project.id,
      sessionId: session.id,
      messages: [{ role: 'user' as const, content: 'oi' }],
    };
    await coletar(
      buildUseCase(provider).execute({ ...base, agentId: 'criativo' }),
    );
    await coletar(buildUseCase(provider).execute(base));
    expect(
      provider.recebidas.map((o) => (o as { sessionKey?: string }).sessionKey),
    ).toEqual([`brabo:${session.id}:criativo`, `brabo:${session.id}`]);
  });

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

  it('custo real na resposta (ADR 0188, RN-665): o frame final e a linha levam o REAL, com o modelo resolvido e o id', async () => {
    const { project, session } = await setup();
    const provider = new FakeProvider([
      { type: 'text_delta', text: 'ok' },
      {
        type: 'usage',
        inputTokens: 1_000,
        outputTokens: 100,
        estimated: false,
        costMicros: 42,
        resolvedModel: 'deepseek/deepseek-v3.2-exp',
        generationId: 'gen-stream-1',
      },
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
    // O catálogo do modelo do teste é gratuito: sem a regra, isto seria 0.
    expect(final.usage).toMatchObject({ costMicros: 42, estimated: false });

    const [linha] = await db
      .select()
      .from(tokenUsage)
      .where(eq(tokenUsage.sessionId, session.id));
    expect(linha).toMatchObject({
      costMicros: 42,
      priceImplicit: true,
      catalogCostMicros: 0,
      resolvedModelName: 'deepseek/deepseek-v3.2-exp',
      generationId: 'gen-stream-1',
    });
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

  it('truncada por raciocínio: retenta UMA vez sem raciocínio, as duas no metering (AT-587, RN-916)', async () => {
    const { project, session, model } = await setup();
    await db
      .update(models)
      .set({ supportsReasoning: true })
      .where(eq(models.id, model.id));
    const cortada: ChatStreamChunk[] = [
      { type: 'truncated' },
      {
        type: 'usage',
        inputTokens: 10,
        outputTokens: 4096,
        estimated: false,
        reasoningTokens: 4096,
      },
    ];
    const ok: ChatStreamChunk[] = [
      { type: 'text_delta', text: 'pronto' },
      { type: 'usage', inputTokens: 10, outputTokens: 2, estimated: false },
    ];
    const roteiros = [cortada, ok, cortada];
    const provider = new FakeProvider([]);
    Object.assign(provider, { aceitaRaciocinioDesligado: true });
    provider.chat = async function* (_m?: unknown, options?: unknown) {
      await Promise.resolve();
      const n = provider.recebidas.push(options) - 1;
      for (const chunk of roteiros[n]) yield chunk;
    };
    const eventos = await coletar(
      buildUseCase(provider).execute({
        projectId: project.id,
        sessionId: session.id,
        agentId: 'po',
        messages: [{ role: 'user', content: 'oi' }],
      }),
    );
    const final = eventos.at(-1);
    if (final?.type !== 'final') throw new Error('esperava um frame final');
    expect(final.message.content).toBe('pronto');
    expect(provider.recebidas).toHaveLength(2);
    expect(
      (provider.recebidas[1] as { reasoningOff?: boolean }).reasoningOff,
    ).toBe(true);
    const linhas = await db
      .select()
      .from(tokenUsage)
      .where(eq(tokenUsage.sessionId, session.id));
    expect(linhas).toHaveLength(2);
  });
  it('404 por nenhum upstream no teto: repete UMA vez sem teto, fator nulo na segunda linha (AT-606, RN-917)', async () => {
    const { project, session, model } = await setup();
    await db
      .update(models)
      .set({
        inputPricePerMillionMicros: 140_000,
        outputPricePerMillionMicros: 420_000,
      })
      .where(eq(models.id, model.id));
    const recusa: ChatStreamChunk[] = [
      {
        type: 'error',
        code: 'price_ceiling',
        message: 'nenhum upstream cabe no teto de preço (404)',
      },
    ];
    const ok: ChatStreamChunk[] = [
      { type: 'text_delta', text: 'pronto' },
      { type: 'usage', inputTokens: 10, outputTokens: 2, estimated: false },
    ];
    const roteiros = [recusa, ok];
    const provider = new FakeProvider([]);
    Object.assign(provider.capabilities, { priceCeiling: true });
    provider.chat = async function* (_m?: unknown, options?: unknown) {
      await Promise.resolve();
      const n = provider.recebidas.push(options) - 1;
      for (const chunk of roteiros[n]) yield chunk;
    };
    const eventos = await coletar(
      buildUseCase(provider).execute({
        projectId: project.id,
        sessionId: session.id,
        agentId: 'po',
        messages: [{ role: 'user', content: 'oi' }],
      }),
    );
    const final = eventos.at(-1);
    if (final?.type !== 'final') throw new Error('esperava um frame final');
    expect(final.error).toBeNull();
    expect(final.message.content).toBe('pronto');
    expect(provider.recebidas).toHaveLength(2);
    expect(provider.recebidas[0]).toMatchObject({
      priceCeiling: {
        inputPerMillionMicros: 210_000,
        outputPerMillionMicros: 630_000,
      },
    });
    expect(provider.recebidas[1]).not.toHaveProperty('priceCeiling');
    const linhas = await db
      .select()
      .from(tokenUsage)
      .where(eq(tokenUsage.sessionId, session.id))
      .orderBy(tokenUsage.createdAt);
    expect(linhas.map((l) => l.priceCeilingFactor)).toEqual([1.5, null]);
  });

  describe('chamada escrita como texto (AT-633, RN-949)', () => {
    const XML =
      'Registrei.\n<invoke name="read_file">\n<parameter name="path">a</parameter>\n</invoke>';
    const ferramentas = [
      { name: 'read_file', description: 'lê', parameters: {} },
    ];
    const usage: ChatStreamChunk = {
      type: 'usage',
      inputTokens: 5,
      outputTokens: 2,
      estimated: false,
    };
    function comRoteiros(roteiros: ChatStreamChunk[][]) {
      const provider = new FakeProvider([]);
      let n = 0;
      provider.chat = async function* () {
        await Promise.resolve();
        for (const c of roteiros[n++]) yield c;
      };
      return { provider, chamadas: () => n };
    }

    it('duas vezes: erro tool_call_as_text, content vazio, 2 linhas de uso, nenhum <invoke> sai', async () => {
      const { project, session } = await setup();
      const { provider, chamadas } = comRoteiros([
        [{ type: 'text_delta', text: XML }, usage],
        [{ type: 'text_delta', text: XML }, usage],
      ]);
      const eventos = await coletar(
        buildUseCase(provider).execute({
          projectId: project.id,
          sessionId: session.id,
          agentId: 'po',
          messages: [{ role: 'user', content: 'oi' }],
          tools: ferramentas,
        }),
      );
      const final = eventos.at(-1);
      if (final?.type !== 'final') throw new Error('esperava final');
      expect(final.errorCode).toBe('tool_call_as_text');
      expect(final.message.content).toBe('');
      expect(final.error).toContain('llama3.2:3b');
      const deltas = eventos.flatMap((e) =>
        e.type === 'delta' ? [e.text] : [],
      );
      expect(deltas.join('')).not.toContain('<invoke');
      const linhas = await db
        .select()
        .from(tokenUsage)
        .where(eq(tokenUsage.sessionId, session.id));
      expect(linhas).toHaveLength(2);
      expect(chamadas()).toBe(2);
    });

    it('segunda resposta limpa: resposta normal e 2 linhas de uso', async () => {
      const { project, session } = await setup();
      const { provider } = comRoteiros([
        [{ type: 'text_delta', text: XML }, usage],
        [{ type: 'text_delta', text: 'pronto' }, usage],
      ]);
      const eventos = await coletar(
        buildUseCase(provider).execute({
          projectId: project.id,
          sessionId: session.id,
          agentId: 'po',
          messages: [{ role: 'user', content: 'oi' }],
          tools: ferramentas,
        }),
      );
      const final = eventos.at(-1);
      if (final?.type !== 'final') throw new Error('esperava final');
      expect(final.error).toBeNull();
      expect(final.message.content).toBe('pronto');
      const linhas = await db
        .select()
        .from(tokenUsage)
        .where(eq(tokenUsage.sessionId, session.id));
      expect(linhas).toHaveLength(2);
    });
  });
});
