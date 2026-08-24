import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { LLMProviderName } from '@brabo/shared';
import { createTestDb, truncateAll } from '../../support/test-db';
import {
  projects,
  sessions,
  tokenUsage,
  users,
  workspaces,
} from '../../../src/db/schema';
import { DrizzleModelRepository } from '../../../src/infrastructure/persistence/drizzle/model.repository';
import { DrizzleModelBindingRepository } from '../../../src/infrastructure/persistence/drizzle/model-binding.repository';
import { DrizzleUserCredentialRepository } from '../../../src/infrastructure/persistence/drizzle/user-credential.repository';
import { DrizzleProjectRepository } from '../../../src/infrastructure/persistence/drizzle/project.repository';
import { DrizzleBudgetRepository } from '../../../src/infrastructure/persistence/drizzle/budget.repository';
import { DrizzleAgentAreaRepository } from '../../../src/infrastructure/persistence/drizzle/agent-area.repository';
import { DrizzleTokenUsageRepository } from '../../../src/infrastructure/persistence/drizzle/token-usage.repository';
import { DrizzleSessionRepository } from '../../../src/infrastructure/persistence/drizzle/session.repository';
import { DrizzleSessionEventRepository } from '../../../src/infrastructure/persistence/drizzle/session-event.repository';
import { DrizzleOutboxRepository } from '../../../src/infrastructure/persistence/drizzle/outbox.repository';
import { DrizzleUnitOfWork } from '../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { EnvelopeEncryptionService } from '../../../src/infrastructure/security/envelope-encryption.service';
import { GptTokenizerEstimator } from '../../../src/infrastructure/tokenization/gpt-tokenizer-estimator';
import { BraboMetrics } from '../../../src/infrastructure/observability/brabo-metrics';
import { LLMCredentialConnectionTesterImpl } from '../../../src/infrastructure/llm/llm-credential-connection-tester';
import { DeepInfraProvider } from '../../../src/infrastructure/llm/deepinfra-provider';
import { UpsertUserCredentialUseCase } from '../../../src/application/use-cases/llm/upsert-user-credential.use-case';
import { TestStoredCredentialUseCase } from '../../../src/application/use-cases/credentials/test-stored-credential.use-case';
import { SyncModelCatalogUseCase } from '../../../src/application/use-cases/llm/sync-model-catalog.use-case';
import { SetModelsActiveUseCase } from '../../../src/application/use-cases/llm/set-models-active.use-case';
import { SetModelBindingUseCase } from '../../../src/application/use-cases/llm/set-model-binding.use-case';
import { ResolveModelBindingUseCase } from '../../../src/application/use-cases/llm/resolve-model-binding.use-case';
import { CheckBudgetGateUseCase } from '../../../src/application/use-cases/llm/check-budget-gate.use-case';
import { RecordLlmUsageUseCase } from '../../../src/application/use-cases/llm/record-llm-usage.use-case';
import {
  SendChatMessageUseCase,
  type ChatSseEvent,
} from '../../../src/application/use-cases/llm/send-chat-message.use-case';
import type { LLMProvider } from '../../../src/application/ports/llm-provider.port';
import type { LLMProviderRegistry } from '../../../src/application/ports/llm-provider-registry.port';

/**
 * Smoke test MANUAL, opcional, contra a API real da DeepInfra — nunca roda
 * em CI por padrão (sem `DEEPINFRA_TEST_KEY`, o describe inteiro é pulado
 * com um aviso). Mesmo molde do smoke do OpenRouter/Together, com uma
 * diferença real: o cadastro (passo 1) NÃO valida a chave — DeepInfra não
 * tem tester declarado (`GET /v1/openai/models` é PÚBLICO, confirmado ao
 * vivo nesta sessão, então não distingue chave boa de ruim). É o passo 4
 * (chat de verdade) quem primeiro rejeitaria uma chave inválida aqui — vale
 * a pena notar que isso é assimetria REAL da DeepInfra, não um buraco do
 * teste.
 *
 * `DEEPINFRA_TEST_MODEL` (default `deepseek-ai/DeepSeek-V3`) escolhe o
 * modelo curado. O turno gasta uma fração de centavo de verdade.
 */
const apiKey = process.env.DEEPINFRA_TEST_KEY;
const modeloAlvo =
  process.env.DEEPINFRA_TEST_MODEL ?? 'deepseek-ai/DeepSeek-V3';

if (!apiKey) {
  console.warn(
    '[smoke] DEEPINFRA_TEST_KEY não definido — suite de smoke do ' +
      'DeepInfraProvider contra a API real foi PULADA. Defina ' +
      'DEEPINFRA_TEST_KEY (chave real, com algum crédito) para habilitar ' +
      'esta suite manualmente — é o aceite que a Fase 11b exige antes de ' +
      'fechar (CLAUDE.md). Opcionalmente, DEEPINFRA_TEST_MODEL escolhe o ' +
      'modelo curado (default: deepseek-ai/DeepSeek-V3).',
  );
}

describe.skipIf(!apiKey)(
  'DeepInfra — aceite com credencial real (Fase 11b, manual)',
  () => {
    const { db, pool } = createTestDb();

    const modelRepo = new DrizzleModelRepository(db);
    const bindingRepo = new DrizzleModelBindingRepository(db);
    const credentialRepo = new DrizzleUserCredentialRepository(db);
    const projectRepo = new DrizzleProjectRepository(db);
    const budgetRepo = new DrizzleBudgetRepository(db);
    const areaRepo = new DrizzleAgentAreaRepository(db);
    const tokenUsageRepo = new DrizzleTokenUsageRepository(db);
    const sessionRepo = new DrizzleSessionRepository(db);
    const sessionEventRepo = new DrizzleSessionEventRepository(db);
    const outboxRepo = new DrizzleOutboxRepository(db);
    const unitOfWork = new DrizzleUnitOfWork(db);
    const encryption = new EnvelopeEncryptionService();
    const tokenEstimator = new GptTokenizerEstimator();

    const deepinfra = new DeepInfraProvider(tokenEstimator);
    const semCatalogo = (nome: LLMProviderName): LLMProvider => ({
      name: nome,
      capabilities: {
        streaming: true,
        toolCalling: true,
        listModels: false,
        embeddings: false,
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      chat: async function* () {
        yield { type: 'text_delta' as const, text: '' };
      },
    });
    const registry: LLMProviderRegistry = {
      get: (nome) => (nome === 'deepinfra' ? deepinfra : semCatalogo(nome)),
    };

    const upsertCredential = new UpsertUserCredentialUseCase(
      credentialRepo,
      encryption,
    );
    // A verificação virou ação própria sobre a credencial GRAVADA (ADR 0050).
    // O tester de git entra como stub: este smoke só toca provider de LLM, e
    // arrastar o Octokit/GitBeaker pra cá seria peso sem prova nenhuma.
    const testStoredCredential = new TestStoredCredentialUseCase(
      credentialRepo,
      encryption,
      new LLMCredentialConnectionTesterImpl(),
      {
        test: () =>
          Promise.reject(new Error('tester de git não é usado neste smoke')),
      },
    );
    const syncCatalog = new SyncModelCatalogUseCase(
      modelRepo,
      credentialRepo,
      encryption,
      registry,
    );
    const setModelsActive = new SetModelsActiveUseCase(modelRepo);
    const setModelBinding = new SetModelBindingUseCase(bindingRepo, modelRepo);
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
      new BraboMetrics(),
    );
    const sendChatMessage = new SendChatMessageUseCase(
      unitOfWork,
      sessionRepo,
      sessionEventRepo,
      outboxRepo,
      modelRepo,
      credentialRepo,
      encryption,
      registry,
      tokenEstimator,
      resolveModelBinding,
      checkBudgetGate,
      recordLlmUsage,
    );

    afterAll(async () => {
      await pool.end();
    });

    it(
      'cadastro (sem validação) → sync (catálogo público) → curadoria → chat de ponta a ponta com custo congelado em token_usage',
      { timeout: 60_000 },
      async () => {
        await truncateAll(db);

        const [owner] = await db
          .insert(users)
          .values({
            keycloakSub: 'sub-deepinfra-smoke',
            email: 'deepinfra-smoke@brabo.dev',
          })
          .returning();
        const [workspace] = await db
          .insert(workspaces)
          .values({
            name: 'smoke',
            slug: 'smoke-deepinfra',
            createdBy: owner.id,
          })
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

        // 1) Cadastro — cifra e grava, SEM testar (ADR 0050). Uma chave
        //    errada é gravada do mesmo jeito; o cadastro não é o lugar do
        //    diagnóstico.
        await upsertCredential.execute(owner.id, 'deepinfra', apiKey!);

        // 1b) Verificação como ação explícita sobre a credencial já gravada —
        //     é ela que prova a chave REAL contra a API real, que é o valor
        //     deste smoke desde o ADR 0043.
        expect(
          await testStoredCredential.execute(owner.id, 'deepinfra'),
        ).toEqual({ resultado: 'nao_suportado' });

        // 2) Sync — catálogo PÚBLICO, funciona mesmo se a chave estiver
        //    errada (é a prova viva de que o tester não serviria pra nada
        //    aqui).
        const syncResult = await syncCatalog.execute();
        const relatorioDeepinfra = syncResult.porProvider.find(
          (p) => p.provider === 'deepinfra',
        );
        expect(
          relatorioDeepinfra,
          `relatório do sync não trouxe 'deepinfra': ${JSON.stringify(syncResult.porProvider)}`,
        ).toBeDefined();
        expect(
          relatorioDeepinfra?.pulado,
          `sync de deepinfra foi pulado: ${JSON.stringify(relatorioDeepinfra)}`,
        ).toBeUndefined();

        const catalogo = await modelRepo.listByProvider('deepinfra');
        expect(
          catalogo.length,
          'catálogo da deepinfra veio vazio depois do sync',
        ).toBeGreaterThan(0);

        const alvo = catalogo.find((m) => m.name === modeloAlvo);
        expect(
          alvo,
          `modelo "${modeloAlvo}" não está no catálogo sincronizado — ` +
            `defina DEEPINFRA_TEST_MODEL com um dos ${catalogo.length} ` +
            `disponíveis (ex.: ${catalogo[0]?.name})`,
        ).toBeDefined();

        // 3) Curadoria — o modelo entrou DESATIVADO (RN-043).
        expect(alvo!.isActive).toBe(false);
        const [ativado] = await setModelsActive.execute({
          modelIds: [alvo!.id],
          isActive: true,
        });
        expect(ativado.isActive).toBe(true);

        await setModelBinding.execute(
          'workspace',
          workspace.id,
          alvo!.id,
          owner.id,
        );

        // 4) Chat de ponta a ponta — AQUI, pela primeira vez, uma chave
        //    inválida derrubaria o teste (erro do provider vira chunk de
        //    erro, e a asserção abaixo falha).
        const eventos: ChatSseEvent[] = [];
        for await (const evento of sendChatMessage.execute({
          projectId: project.id,
          sessionId: session.id,
          actor: { kind: 'user', id: owner.id },
          text: 'Responda só a palavra "ok", sem mais nada.',
        })) {
          eventos.push(evento);
        }

        expect(
          eventos.find(
            (e) => e.type === 'error' || e.type === 'metering_failed',
          ),
          `turno de chat falhou: ${JSON.stringify(eventos)}`,
        ).toBeUndefined();
        const feito = eventos.find((e) => e.type === 'done');
        expect(
          feito,
          `sem evento 'done': ${JSON.stringify(eventos)}`,
        ).toBeDefined();

        // Custo CONGELADO em token_usage (RN-044).
        const [uso] = await db
          .select()
          .from(tokenUsage)
          .where(eq(tokenUsage.sessionId, session.id));

        expect(
          uso,
          'nenhuma linha em token_usage para a sessão do smoke',
        ).toBeDefined();
        expect(uso.provider).toBe('deepinfra');
        expect(uso.modelName).toBe(modeloAlvo);
        expect(uso.inputPricePerMillionMicros).toBe(
          ativado.inputPricePerMillionMicros,
        );
        expect(uso.outputPricePerMillionMicros).toBe(
          ativado.outputPricePerMillionMicros,
        );
        expect(uso.costMicros).toBeGreaterThanOrEqual(0);

        // DeepInfra não é hub — sem `extrairUpstreamProvider` na config.
        expect(uso.upstreamProvider).toBeNull();
      },
    );
  },
);
