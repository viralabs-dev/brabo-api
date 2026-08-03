import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerResponse } from 'node:http';
import type { LLMProviderName } from '@brabo/shared';
import { LLM_PROVIDER_NAMES } from '../../../../src/domain/llm/llm-provider-names';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { models, users, workspaces } from '../../../../src/db/schema';
import { DrizzleModelRepository } from '../../../../src/infrastructure/persistence/drizzle/model.repository';
import { DrizzleUserCredentialRepository } from '../../../../src/infrastructure/persistence/drizzle/user-credential.repository';
import { EnvelopeEncryptionService } from '../../../../src/infrastructure/security/envelope-encryption.service';
import { DrizzleModelPriceChangeRepository } from '../../../../src/infrastructure/persistence/drizzle/model-price-change.repository';
import { DrizzleWorkspaceModelRepository } from '../../../../src/infrastructure/persistence/drizzle/workspace-model.repository';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { OpenAICompatibleProvider } from '../../../../src/infrastructure/llm/openai-compatible-provider';
import { openaiConfig } from '../../../../src/infrastructure/llm/openai-provider';
import { deepinfraConfig } from '../../../../src/infrastructure/llm/deepinfra-provider';
import { SyncModelCatalogUseCase } from '../../../../src/application/use-cases/llm/sync-model-catalog.use-case';
import { LLMProviderRegistry } from '../../../../src/application/ports/llm-provider-registry.port';
import type { LLMProvider } from '../../../../src/application/ports/llm-provider.port';
import {
  subirServidorFalso,
  type ServidorFalso,
} from '../../../support/llm/fake-llm-server';

const { db, pool } = createTestDb();
const modelRepo = new DrizzleModelRepository(db);
const credentialRepo = new DrizzleUserCredentialRepository(db);
const priceChangeRepo = new DrizzleModelPriceChangeRepository(db);
const workspaceModelRepo = new DrizzleWorkspaceModelRepository(db);
const unitOfWork = new DrizzleUnitOfWork(db);
const encryption = new EnvelopeEncryptionService();

/**
 * O catálogo que o "provider" devolve nesta rodada. O teste mexe nele para
 * simular modelo novo, modelo que sumiu e modelo que voltou — que são
 * exatamente as três regras de reconciliação da RN-043.
 */
let catalogoRemoto: string[] = [];
let status = 200;

/**
 * O preço que o catálogo remoto informa, em dólares por token — a unidade do
 * shape da DeepInfra. `null` é o catálogo que NÃO informa preço, que é o caso
 * da OpenAI e o único que existia antes.
 */
let precoRemoto: { entrada: number; saida: number } | null = null;

/**
 * Um corpo só, servindo os dois parsers: `id` é o que o parser padrão lê, e
 * `metadata` é o que o `parseCatalogoDeepInfra` lê. Assim o mesmo servidor
 * falso atende o provider sem preço (OpenAI) e o provider com preço
 * (DeepInfra) sem precisar rotear por path.
 */
function dialetoCatalogo(_cenario: unknown, res: ServerResponse): void {
  if (status !== 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'chave revogada' } }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      object: 'list',
      data: catalogoRemoto.map((id) => ({
        id,
        object: 'model',
        metadata: {
          tags: ['chat'],
          ...(precoRemoto
            ? {
                pricing: {
                  input_tokens: precoRemoto.entrada,
                  output_tokens: precoRemoto.saida,
                },
              }
            : {}),
        },
      })),
    }),
  );
}

/**
 * OpenAI (catálogo SEM preço) e DeepInfra (catálogo COM preço) declaram
 * `listModels`; o resto entra no relatório como `sem_capability`, que é o
 * comportamento que o teste também quer provar.
 *
 * Os dois são necessários porque as regras de preço só se distinguem quando o
 * remoto tem uma opinião sobre preço: com o catálogo da OpenAI, "não
 * sobrescrever preço manual" e "sobrescrever" dão o mesmo resultado.
 */
function registryApontadoPara(baseUrl: string): LLMProviderRegistry {
  const openai = new OpenAICompatibleProvider(openaiConfig(baseUrl));
  const deepinfra = new OpenAICompatibleProvider(deepinfraConfig(baseUrl));
  const semCatalogo = (nome: LLMProviderName): LLMProvider => ({
    name: nome,
    capabilities: { streaming: true, toolCalling: true, listModels: false },
    // eslint-disable-next-line @typescript-eslint/require-await
    chat: async function* () {
      yield { type: 'text_delta' as const, text: '' };
    },
  });

  return {
    get: (nome) => {
      if (nome === 'openai') return openai;
      if (nome === 'deepinfra') return deepinfra;
      return semCatalogo(nome);
    },
  };
}

let servidor: ServidorFalso;
let useCase: SyncModelCatalogUseCase;

async function comCredencialDaOpenAI() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-sync', email: 'sync@brabo.dev' })
    .returning();
  await credentialRepo.upsert(
    user.id,
    'openai',
    encryption.encrypt('sk-de-teste'),
  );
  return user;
}

async function workspaceRepoAtivos(workspaceId: string) {
  return (await workspaceModelRepo.listActive(workspaceId)).map((m) => m.name);
}

async function workspaceDeTeste() {
  const [dono] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-ws-sync', email: 'ws-sync@brabo.dev' })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'Sync', slug: 'sync-ws', createdBy: dono.id })
    .returning();
  return ws;
}

async function comCredencialDaDeepInfra() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-sync-di', email: 'sync-di@brabo.dev' })
    .returning();
  await credentialRepo.upsert(
    user.id,
    'deepinfra',
    encryption.encrypt('di-de-teste'),
  );
  return user;
}

beforeEach(async () => {
  await truncateAll(db);
  catalogoRemoto = [];
  status = 200;
  precoRemoto = null;
  servidor = await subirServidorFalso(dialetoCatalogo);
  useCase = new SyncModelCatalogUseCase(
    modelRepo,
    credentialRepo,
    encryption,
    registryApontadoPara(servidor.baseUrl),
    priceChangeRepo,
    unitOfWork,
  );
});

afterEach(async () => {
  await servidor.fechar();
});

afterAll(async () => {
  await pool.end();
});

describe('SyncModelCatalogUseCase', () => {
  it('caminho feliz: o que o sync descobre entra INATIVO (RN-043)', async () => {
    await comCredencialDaOpenAI();
    const ws = await workspaceDeTeste();
    catalogoRemoto = ['gpt-4o-mini', 'gpt-4o'];

    const resultado = await useCase.execute();

    expect(
      resultado.porProvider.find((p) => p.provider === 'openai'),
    ).toMatchObject({ descobertos: 2, indisponibilizados: 0 });

    const gravados = await modelRepo.listByProvider('openai');
    expect(gravados.map((m) => m.name).sort()).toEqual([
      'gpt-4o',
      'gpt-4o-mini',
    ]);
    // O ponto da regra: nada foi ligado sozinho. Desde o ADR 0049 isso se
    // observa pela AUSÊNCIA de linha de curadoria — o sync não tem mais uma
    // coluna em `models` para escrever, mesmo que quisesse.
    expect(await workspaceRepoAtivos(ws.id)).toEqual([]);
    expect(gravados.every((m) => m.availability === 'available')).toBe(true);
    expect(gravados.every((m) => m.lastSeenAt !== null)).toBe(true);
  });

  it('modelo que sumiu do catálogo vira indisponível — e NÃO é deletado', async () => {
    await comCredencialDaOpenAI();
    catalogoRemoto = ['gpt-4o-mini', 'gpt-4o'];
    await useCase.execute();

    catalogoRemoto = ['gpt-4o-mini'];
    const resultado = await useCase.execute();

    expect(
      resultado.porProvider.find((p) => p.provider === 'openai'),
    ).toMatchObject({ descobertos: 0, indisponibilizados: 1 });

    const gravados = await modelRepo.listByProvider('openai');
    expect(gravados).toHaveLength(2);
    expect(gravados.find((m) => m.name === 'gpt-4o')?.availability).toBe(
      'unavailable',
    );
  });

  it('modelo que voltou fica disponível de novo com a curadoria do owner intacta', async () => {
    await comCredencialDaOpenAI();
    catalogoRemoto = ['gpt-4o'];
    await useCase.execute();

    const [antes] = await modelRepo.listByProvider('openai');
    // A curadoria mora em `workspace_models` desde o ADR 0049 — o sync não a
    // alcança, e é isso que este teste continua provando: o eixo do provider
    // (`availability`) vai e volta sem tocar no eixo de quem opera.
    const ws = await workspaceDeTeste();
    await workspaceModelRepo.setActive({
      workspaceId: ws.id,
      modelIds: [antes.id],
      isActive: true,
      curatedBy: ws.createdBy,
    });

    catalogoRemoto = [];
    await useCase.execute();
    expect((await modelRepo.findById(antes.id))?.availability).toBe(
      'unavailable',
    );

    catalogoRemoto = ['gpt-4o'];
    const resultado = await useCase.execute();

    expect(
      resultado.porProvider.find((p) => p.provider === 'openai'),
    ).toMatchObject({ reencontrados: 1 });

    expect((await modelRepo.findById(antes.id))?.availability).toBe(
      'available',
    );
    // A escolha de quem curou sobreviveu à ausência — é a razão dos dois eixos.
    expect(await workspaceModelRepo.isActive(ws.id, antes.id)).toBe(true);
  });

  it('preço digitado à mão não é zerado por um catálogo que não informa preço', async () => {
    await comCredencialDaOpenAI();
    await db.insert(models).values({
      provider: 'openai',
      name: 'gpt-4o',
      displayName: 'GPT-4o',
      inputPricePerMillionMicros: 2_500_000,
      outputPricePerMillionMicros: 10_000_000,
      manualPricing: true,
    });

    catalogoRemoto = ['gpt-4o'];
    await useCase.execute();

    const [depois] = await modelRepo.listByProvider('openai');
    expect(depois).toMatchObject({
      inputPricePerMillionMicros: 2_500_000,
      outputPricePerMillionMicros: 10_000_000,
    });
  });

  it('preço digitado à mão vence o catálogo que INFORMA preço (RN-044)', async () => {
    await comCredencialDaDeepInfra();
    await db.insert(models).values({
      provider: 'deepinfra',
      name: 'deepseek-ai/DeepSeek-V3',
      displayName: 'DeepSeek V3',
      inputPricePerMillionMicros: 2_500_000,
      outputPricePerMillionMicros: 10_000_000,
      manualPricing: true,
    });

    // O caso que o teste acima NÃO cobria: aqui o remoto tem uma opinião, e a
    // pergunta é de quem é o número. `schema.ts` sempre respondeu "de quem
    // digitou"; o código respondia "do remoto".
    catalogoRemoto = ['deepseek-ai/DeepSeek-V3'];
    precoRemoto = { entrada: 0.32, saida: 0.89 };
    await useCase.execute();

    const [depois] = await modelRepo.listByProvider('deepinfra');
    expect(depois).toMatchObject({
      inputPricePerMillionMicros: 2_500_000,
      outputPricePerMillionMicros: 10_000_000,
      manualPricing: true,
    });
    // Preço que não mudou não vira linha de auditoria — seria ruído.
    expect(await priceChangeRepo.listByModel(depois.id)).toHaveLength(0);
  });

  it('preço trocado pelo sync deixa linha de auditoria com origem `sync` (RN-044)', async () => {
    await comCredencialDaDeepInfra();
    catalogoRemoto = ['deepseek-ai/DeepSeek-V3'];
    precoRemoto = { entrada: 0.32, saida: 0.89 };
    await useCase.execute();

    const [descoberto] = await modelRepo.listByProvider('deepinfra');
    expect(descoberto).toMatchObject({
      inputPricePerMillionMicros: 320_000,
      outputPricePerMillionMicros: 890_000,
      // Preço veio do catálogo: a origem é o sync, não a mão de ninguém.
      manualPricing: false,
    });
    // O INSERT não é "mudança de preço": não havia preço antes.
    expect(await priceChangeRepo.listByModel(descoberto.id)).toHaveLength(0);

    precoRemoto = { entrada: 0.4, saida: 1.2 };
    await useCase.execute();

    const [reprecificado] = await modelRepo.listByProvider('deepinfra');
    expect(reprecificado).toMatchObject({
      inputPricePerMillionMicros: 400_000,
      outputPricePerMillionMicros: 1_200_000,
    });

    const auditoria = await priceChangeRepo.listByModel(descoberto.id);
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      inputBeforeMicros: 320_000,
      inputAfterMicros: 400_000,
      outputBeforeMicros: 890_000,
      outputAfterMicros: 1_200_000,
      source: 'sync',
      // Sem pessoa por trás — é o que distingue a linha de uma edição na UI.
      changedBy: null,
    });
  });

  it('sync que não mexe em preço não escreve auditoria nenhuma', async () => {
    await comCredencialDaDeepInfra();
    catalogoRemoto = ['deepseek-ai/DeepSeek-V3'];
    precoRemoto = { entrada: 0.32, saida: 0.89 };
    await useCase.execute();
    await useCase.execute();

    const [modelo] = await modelRepo.listByProvider('deepinfra');
    expect(await priceChangeRepo.listByModel(modelo.id)).toHaveLength(0);
  });

  it('falha: provider que recusa a chave é PULADO com a origem, sem indisponibilizar nada', async () => {
    await comCredencialDaOpenAI();
    catalogoRemoto = ['gpt-4o'];
    await useCase.execute();

    // A chave foi revogada. "Não sei o que tem lá" não é "não tem nada lá":
    // marcar tudo como sumido derrubaria todos os bindings do provider.
    status = 401;
    const resultado = await useCase.execute();

    expect(
      resultado.porProvider.find((p) => p.provider === 'openai'),
    ).toMatchObject({
      pulado: 'falha',
      origemDaFalha: 'modelo',
      indisponibilizados: 0,
    });

    const [intocado] = await modelRepo.listByProvider('openai');
    expect(intocado.availability).toBe('available');
  });

  it('falha: sem credencial cadastrada o provider é pulado com o motivo certo', async () => {
    catalogoRemoto = ['gpt-4o'];

    const resultado = await useCase.execute();

    expect(
      resultado.porProvider.find((p) => p.provider === 'openai'),
    ).toMatchObject({ pulado: 'sem_credencial' });
    expect(await modelRepo.listByProvider('openai')).toHaveLength(0);
  });

  it('provider sem a capability aparece no relatório em vez de sumir dele', async () => {
    const resultado = await useCase.execute();

    expect(
      resultado.porProvider.find((p) => p.provider === 'anthropic'),
    ).toMatchObject({ pulado: 'sem_capability' });
    // Um por provider da taxonomia inteira (RN-043) — cresce junto com
    // LLM_PROVIDER_NAMES, não é um número fixo desta suite.
    expect(resultado.porProvider).toHaveLength(LLM_PROVIDER_NAMES.length);
  });
});
