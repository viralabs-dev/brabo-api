import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerResponse } from 'node:http';
import type { LLMProviderName } from '@brabo/shared';
import { LLM_PROVIDER_NAMES } from '../../../../src/domain/llm/llm-provider-names';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { models, users } from '../../../../src/db/schema';
import { DrizzleModelRepository } from '../../../../src/infrastructure/persistence/drizzle/model.repository';
import { DrizzleUserCredentialRepository } from '../../../../src/infrastructure/persistence/drizzle/user-credential.repository';
import { EnvelopeEncryptionService } from '../../../../src/infrastructure/security/envelope-encryption.service';
import { OpenAICompatibleProvider } from '../../../../src/infrastructure/llm/openai-compatible-provider';
import { openaiConfig } from '../../../../src/infrastructure/llm/openai-provider';
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
const encryption = new EnvelopeEncryptionService();

/**
 * O catálogo que o "provider" devolve nesta rodada. O teste mexe nele para
 * simular modelo novo, modelo que sumiu e modelo que voltou — que são
 * exatamente as três regras de reconciliação da RN-043.
 */
let catalogoRemoto: string[] = [];
let status = 200;

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
      data: catalogoRemoto.map((id) => ({ id, object: 'model' })),
    }),
  );
}

/**
 * Só a OpenAI declara `listModels` nesta fase — Ollama e Anthropic entram no
 * relatório como `sem_capability`, que é o comportamento que o teste também
 * quer provar.
 */
function registryApontadoPara(baseUrl: string): LLMProviderRegistry {
  const openai = new OpenAICompatibleProvider(openaiConfig(baseUrl));
  const semCatalogo = (nome: LLMProviderName): LLMProvider => ({
    name: nome,
    capabilities: { streaming: true, toolCalling: true, listModels: false },
    // eslint-disable-next-line @typescript-eslint/require-await
    chat: async function* () {
      yield { type: 'text_delta' as const, text: '' };
    },
  });

  return {
    get: (nome) => (nome === 'openai' ? openai : semCatalogo(nome)),
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

beforeEach(async () => {
  await truncateAll(db);
  catalogoRemoto = [];
  status = 200;
  servidor = await subirServidorFalso(dialetoCatalogo);
  useCase = new SyncModelCatalogUseCase(
    modelRepo,
    credentialRepo,
    encryption,
    registryApontadoPara(servidor.baseUrl),
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
    // O ponto da regra: nada foi ligado sozinho.
    expect(gravados.every((m) => !m.isActive)).toBe(true);
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
    await modelRepo.setActive([antes.id], true);

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

    const depois = await modelRepo.findById(antes.id);
    expect(depois).toMatchObject({
      availability: 'available',
      // A escolha do owner sobreviveu à ausência — é a razão dos dois eixos.
      isActive: true,
    });
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
