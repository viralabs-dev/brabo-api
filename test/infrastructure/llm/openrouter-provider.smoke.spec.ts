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
import { DrizzleWorkspaceModelRepository } from '../../../src/infrastructure/persistence/drizzle/workspace-model.repository';
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
import { OpenRouterProvider } from '../../../src/infrastructure/llm/openrouter-provider';
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
 * Smoke test MANUAL, opcional, contra a API real do OpenRouter — nunca roda
 * em CI por padrão (sem `OPENROUTER_TEST_KEY`, o describe inteiro é pulado
 * com um aviso claro). Mesmo molde dos smokes de git
 * (`github-provider.smoke.spec.ts`): reusa infraestrutura de produção de
 * ponta a ponta, só o CREDENCIAL é real.
 *
 * Este é o ACEITE que a Fase 11a exige antes de fechar (CLAUDE.md): cadastro
 * (com o teste de conexão de verdade) → sync populando o catálogo de verdade
 * → ativação curada de 1 modelo → sessão de chat de ponta a ponta com custo
 * congelado em `token_usage`. As QUATRO etapas viram UM teste sequencial, não
 * quatro — é o mesmo fluxo, e um `it` por etapa exigiria estado entre
 * `it`s (frágil no vitest) ou repetir setup à toa.
 *
 * `OPENROUTER_TEST_MODEL` (default `openai/gpt-4o-mini`, um modelo pago
 * barato quase sempre presente no catálogo) escolhe qual modelo curar e
 * usar no turno de chat — troque se o catálogo do OpenRouter não tiver esse
 * id no momento do teste. O turno gasta uma fração de centavo de verdade na
 * chave informada.
 */
const apiKey = process.env.OPENROUTER_TEST_KEY;
const modeloAlvo = process.env.OPENROUTER_TEST_MODEL ?? 'openai/gpt-4o-mini';

if (!apiKey) {
  console.warn(
    '[smoke] OPENROUTER_TEST_KEY não definido — suite de smoke do ' +
      'OpenRouterProvider contra a API real foi PULADA. Defina ' +
      'OPENROUTER_TEST_KEY (chave real, com algum crédito) para habilitar ' +
      'esta suite manualmente — é o aceite que a Fase 11a exige antes de ' +
      'fechar (CLAUDE.md). Opcionalmente, OPENROUTER_TEST_MODEL escolhe o ' +
      'modelo curado (default: openai/gpt-4o-mini).',
  );
}

describe.skipIf(!apiKey)(
  'OpenRouter — aceite com credencial real (Fase 11a, manual)',
  () => {
    const { db, pool } = createTestDb();

    const modelRepo = new DrizzleModelRepository(db);
    const workspaceModelRepo = new DrizzleWorkspaceModelRepository(db);
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

    // Só o OpenRouter é real; os demais entram como `sem_capability` no
    // relatório do sync — mesmo harness de
    // `sync-model-catalog.use-case.spec.ts`, aqui contra a API de verdade.
    const openrouter = new OpenRouterProvider(tokenEstimator);
    const semCatalogo = (nome: LLMProviderName): LLMProvider => ({
      name: nome,
      capabilities: { streaming: true, toolCalling: true, listModels: false },
      // eslint-disable-next-line @typescript-eslint/require-await
      chat: async function* () {
        yield { type: 'text_delta' as const, text: '' };
      },
    });
    const registry: LLMProviderRegistry = {
      get: (nome) => (nome === 'openrouter' ? openrouter : semCatalogo(nome)),
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
    const setModelsActive = new SetModelsActiveUseCase(
      modelRepo,
      workspaceModelRepo,
    );
    const setModelBinding = new SetModelBindingUseCase(
      bindingRepo,
      modelRepo,
      workspaceModelRepo,
      projectRepo,
    );
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
      'cadastro → sync → curadoria → chat de ponta a ponta com custo congelado em token_usage',
      { timeout: 60_000 },
      async () => {
        await truncateAll(db);

        const [owner] = await db
          .insert(users)
          .values({
            keycloakSub: 'sub-openrouter-smoke',
            email: 'openrouter-smoke@brabo.dev',
          })
          .returning();
        const [workspace] = await db
          .insert(workspaces)
          .values({
            name: 'smoke',
            slug: 'smoke-openrouter',
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
        await upsertCredential.execute(owner.id, 'openrouter', apiKey!);

        // 1b) Verificação como ação explícita sobre a credencial já gravada —
        //     é ela que prova a chave REAL contra a API real, que é o valor
        //     deste smoke desde o ADR 0043.
        expect(
          await testStoredCredential.execute(owner.id, 'openrouter'),
        ).toEqual({ resultado: 'ok' });

        // 2) Sync — puxa o catálogo de verdade do OpenRouter.
        const syncResult = await syncCatalog.execute();
        const relatorioOpenrouter = syncResult.porProvider.find(
          (p) => p.provider === 'openrouter',
        );
        expect(
          relatorioOpenrouter,
          `relatório do sync não trouxe 'openrouter': ${JSON.stringify(syncResult.porProvider)}`,
        ).toBeDefined();
        expect(
          relatorioOpenrouter?.pulado,
          `sync de openrouter foi pulado: ${JSON.stringify(relatorioOpenrouter)}`,
        ).toBeUndefined();

        const catalogo = await modelRepo.listByProvider('openrouter');
        expect(
          catalogo.length,
          'catálogo do openrouter veio vazio depois do sync',
        ).toBeGreaterThan(0);

        const alvo = catalogo.find((m) => m.name === modeloAlvo);
        expect(
          alvo,
          `modelo "${modeloAlvo}" não está no catálogo sincronizado — ` +
            `defina OPENROUTER_TEST_MODEL com um dos ${catalogo.length} ` +
            `disponíveis (ex.: ${catalogo[0]?.name})`,
        ).toBeDefined();

        // 3) Curadoria — o modelo entrou DESATIVADO (RN-043); ativar é
        //    decisão explícita do owner, nunca automática.
        //
        // A pergunta é feita ao `workspace_models`, não a uma coluna de
        // `models`: desde o ADR 0049 a curadoria é POR WORKSPACE, e o
        // desligado é a AUSÊNCIA de linha. Este smoke ainda afirmava
        // `alvo.isActive === false` sobre o catálogo global — campo que não
        // existe mais, e que vinha `undefined`. Passou despercebido porque o
        // smoke nunca tinha rodado: sem `OPENROUTER_TEST_KEY` o describe
        // inteiro é pulado.
        expect(
          await workspaceModelRepo.isActive(workspace.id, alvo!.id),
          'modelo descoberto pelo sync não pode nascer ativo (RN-043)',
        ).toBe(false);
        const [ativado] = await setModelsActive.execute({
          workspaceId: workspace.id,
          modelIds: [alvo!.id],
          isActive: true,
          curatedBy: owner.id,
        });
        expect(ativado.isActive).toBe(true);

        await setModelBinding.execute(
          'workspace',
          workspace.id,
          alvo!.id,
          owner.id,
        );

        // 4) Chat de ponta a ponta.
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

        // Custo CONGELADO em token_usage (RN-044): o preço gravado na linha é
        // o que produziu o cost_micros, não o que `models` tem HOJE.
        const [uso] = await db
          .select()
          .from(tokenUsage)
          .where(eq(tokenUsage.sessionId, session.id));

        expect(
          uso,
          'nenhuma linha em token_usage para a sessão do smoke',
        ).toBeDefined();
        expect(uso.provider).toBe('openrouter');
        expect(uso.modelName).toBe(modeloAlvo);
        expect(uso.inputPricePerMillionMicros).toBe(
          ativado.inputPricePerMillionMicros,
        );
        expect(uso.outputPricePerMillionMicros).toBe(
          ativado.outputPricePerMillionMicros,
        );
        expect(uso.costMicros).toBeGreaterThanOrEqual(0);

        // Metering por upstream_provider (Fase 9b/11a): quem SERVIU a
        // chamada, não só o vendor prefixado no id pedido. Se isto vier nulo,
        // é um quirk real do OpenRouter pra registrar no doc — não um bug do
        // teste.
        expect(
          uso.upstreamProvider,
          'OpenRouter não informou upstream_provider no frame — quirk a registrar em docs/reference/llm-providers.md',
        ).toBeTruthy();
      },
    );
  },
);
