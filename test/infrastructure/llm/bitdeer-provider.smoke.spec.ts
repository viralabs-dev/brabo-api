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
import { DrizzleTokenUsageRepository } from '../../../src/infrastructure/persistence/drizzle/token-usage.repository';
import { DrizzleSessionRepository } from '../../../src/infrastructure/persistence/drizzle/session.repository';
import { DrizzleSessionEventRepository } from '../../../src/infrastructure/persistence/drizzle/session-event.repository';
import { DrizzleOutboxRepository } from '../../../src/infrastructure/persistence/drizzle/outbox.repository';
import { DrizzleUnitOfWork } from '../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { EnvelopeEncryptionService } from '../../../src/infrastructure/security/envelope-encryption.service';
import { GptTokenizerEstimator } from '../../../src/infrastructure/tokenization/gpt-tokenizer-estimator';
import { BraboMetrics } from '../../../src/infrastructure/observability/brabo-metrics';
import { LLMCredentialConnectionTesterImpl } from '../../../src/infrastructure/llm/llm-credential-connection-tester';
import { BitdeerProvider } from '../../../src/infrastructure/llm/bitdeer-provider';
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
 * Smoke test MANUAL, opcional, contra a API real da Bitdeer — nunca roda em
 * CI por padrão (sem `BITDEER_TEST_KEY`, o describe inteiro é pulado com um
 * aviso). Mesmo molde do smoke da NIM (Fase 11b): sem catálogo
 * (`listModels: false`), a curadoria parte de um modelo inserido
 * manualmente — mas AQUI, diferente da NIM, o cadastro (passo 1) VALIDA de
 * verdade (`GET /v1/models`, confirmado ao vivo 401 sem chave).
 *
 * `BITDEER_TEST_MODEL` (default `moonshotai/Kimi-K2.5`, um dos três ids
 * REAIS confirmados em exemplo de config do blog da própria Bitdeer nesta
 * sessão) escolhe o modelo curado. Este smoke é também a primeira
 * confirmação de verdade de que a Bitdeer fala SSE no dialeto OpenAI padrão
 * — nenhuma doc pública mostrou isso, só a claim de compatibilidade.
 */
const apiKey = process.env.BITDEER_TEST_KEY;
const modeloAlvo = process.env.BITDEER_TEST_MODEL ?? 'moonshotai/Kimi-K2.5';

if (!apiKey) {
  console.warn(
    '[smoke] BITDEER_TEST_KEY não definido — suite de smoke do ' +
      'BitdeerProvider contra a API real foi PULADA. Defina ' +
      'BITDEER_TEST_KEY (chave real, com algum crédito) para habilitar ' +
      'esta suite manualmente — é o aceite que a Fase 11b exige antes de ' +
      'fechar (CLAUDE.md). Opcionalmente, BITDEER_TEST_MODEL escolhe o ' +
      'modelo curado (default: moonshotai/Kimi-K2.5).',
  );
}

describe.skipIf(!apiKey)(
  'Bitdeer — aceite com credencial real (Fase 11b, manual)',
  () => {
    const { db, pool } = createTestDb();

    const modelRepo = new DrizzleModelRepository(db);
    const bindingRepo = new DrizzleModelBindingRepository(db);
    const credentialRepo = new DrizzleUserCredentialRepository(db);
    const projectRepo = new DrizzleProjectRepository(db);
    const budgetRepo = new DrizzleBudgetRepository(db);
    const tokenUsageRepo = new DrizzleTokenUsageRepository(db);
    const sessionRepo = new DrizzleSessionRepository(db);
    const sessionEventRepo = new DrizzleSessionEventRepository(db);
    const outboxRepo = new DrizzleOutboxRepository(db);
    const unitOfWork = new DrizzleUnitOfWork(db);
    const encryption = new EnvelopeEncryptionService();
    const tokenEstimator = new GptTokenizerEstimator();

    const bitdeer = new BitdeerProvider(tokenEstimator);
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
      get: (nome) => (nome === 'bitdeer' ? bitdeer : semCatalogo(nome)),
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
    const checkBudgetGate = new CheckBudgetGateUseCase(budgetRepo);
    const recordLlmUsage = new RecordLlmUsageUseCase(
      tokenUsageRepo,
      budgetRepo,
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
      'cadastro (valida de verdade) → sync (sem_capability) → curadoria manual → chat de ponta a ponta com custo congelado em token_usage',
      { timeout: 60_000 },
      async () => {
        await truncateAll(db);

        const [owner] = await db
          .insert(users)
          .values({
            keycloakSub: 'sub-bitdeer-smoke',
            email: 'bitdeer-smoke@brabo.dev',
          })
          .returning();
        const [workspace] = await db
          .insert(workspaces)
          .values({ name: 'smoke', slug: 'smoke-bitdeer', createdBy: owner.id })
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
        await upsertCredential.execute(owner.id, 'bitdeer', apiKey!);

        // 1b) Verificação como ação explícita sobre a credencial já gravada —
        //     é ela que prova a chave REAL contra a API real, que é o valor
        //     deste smoke desde o ADR 0043.
        expect(await testStoredCredential.execute(owner.id, 'bitdeer')).toEqual(
          { resultado: 'ok' },
        );

        // 2) Sync — confirma que a capability declarada é respeitada.
        const syncResult = await syncCatalog.execute();
        const relatorioBitdeer = syncResult.porProvider.find(
          (p) => p.provider === 'bitdeer',
        );
        expect(
          relatorioBitdeer,
          `relatório do sync não trouxe 'bitdeer': ${JSON.stringify(syncResult.porProvider)}`,
        ).toBeDefined();
        expect(relatorioBitdeer?.pulado).toBe('sem_capability');

        // 3) Curadoria manual — sem sync, o modelo entra igual a um owner
        //    rodando o seed e depois ativando na tela.
        const inserido = await modelRepo.upsertByProviderAndName({
          provider: 'bitdeer',
          name: modeloAlvo,
          displayName: modeloAlvo,
          inputPricePerMillionMicros: 900_000,
          outputPricePerMillionMicros: 3_500_000,
          supportsToolCalling: false,
          manualPricing: true,
          isActive: false,
        });
        expect(inserido.isActive).toBe(false);

        const [ativado] = await setModelsActive.execute({
          modelIds: [inserido.id],
          isActive: true,
        });
        expect(ativado.isActive).toBe(true);

        await setModelBinding.execute(
          'workspace',
          workspace.id,
          inserido.id,
          owner.id,
        );

        // 4) Chat de ponta a ponta — primeira confirmação real de que a
        //    Bitdeer fala SSE no dialeto OpenAI padrão.
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
        expect(uso.provider).toBe('bitdeer');
        expect(uso.modelName).toBe(modeloAlvo);
        expect(uso.inputPricePerMillionMicros).toBe(
          ativado.inputPricePerMillionMicros,
        );
        expect(uso.outputPricePerMillionMicros).toBe(
          ativado.outputPricePerMillionMicros,
        );
        expect(uso.costMicros).toBeGreaterThanOrEqual(0);

        // Bitdeer não é hub — sem `extrairUpstreamProvider` na config.
        expect(uso.upstreamProvider).toBeNull();
      },
    );
  },
);
