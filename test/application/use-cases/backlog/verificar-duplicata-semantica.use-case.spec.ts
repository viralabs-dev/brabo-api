import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ATOR_DA_DUPLICATA_SEMANTICA,
  VerificarDuplicataSemanticaUseCase,
} from '../../../../src/application/use-cases/backlog/verificar-duplicata-semantica.use-case';
import type { StoryRepository } from '../../../../src/application/ports/backlog-repository.port';
import type { SessionEventRepository } from '../../../../src/application/ports/session-event-repository.port';
import type { ModelRepository } from '../../../../src/application/ports/model-repository.port';
import type { RagEmbeddingService } from '../../../../src/application/use-cases/rag/rag-embedding.service';
import type { RecordLlmUsageUseCase } from '../../../../src/application/use-cases/llm/record-llm-usage.use-case';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import {
  LIMIAR_DE_DUPLICATA_SEMANTICA,
  TETO_DE_COMPARACOES_DE_DUPLICATA,
  TETO_DE_TEMPO_DA_CHECAGEM_MS,
} from '../../../../src/domain/backlog/duplicata-semantica';

/**
 * RN-681 (AT-171, ADR 0198). Os vetores aqui são SINTÉTICOS e escolhidos à
 * mão para cair de um lado ou do outro do limiar: o que se prova é o
 * MECANISMO (avisa, não avisa, pula dizendo, mede, nunca lança). Quem prova o
 * NÚMERO é `limiar-de-duplicata.calibracao.spec.ts`, sobre vetores gravados.
 */

const PROJECT = 'p1';
const SESSION = 's1';

/** Vetor 2D no ângulo dado — cosseno entre dois deles = cos(Δângulo). */
function angulo(graus: number): number[] {
  const r = (graus * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

class FakeStories {
  existentes: { id: string; title: string; createdAt: Date }[] = [];
  findByProject() {
    return Promise.resolve(this.existentes);
  }
}

class FakeEvents {
  regras: {
    id: string;
    payload: unknown;
    createdAt: Date;
  }[] = [];
  listByTypeForProject(_p: string, tipo: string) {
    expect(tipo).toBe('artifact.business_rule');
    return Promise.resolve(this.regras);
  }
}

class FakeModels {
  catalogo = [
    {
      id: 'm-nomic',
      name: 'nomic-embed-text:latest',
      inputPricePerMillionMicros: 20_000,
    },
  ];
  listByProvider() {
    return Promise.resolve(this.catalogo);
  }
}

class FakeEmbeddings {
  vetorPorTexto = new Map<string, number[]>();
  chamadas: string[][] = [];
  indisponivel: string | null = null;
  nuncaResponde = false;
  embedMany(textos: readonly string[]) {
    this.chamadas.push([...textos]);
    if (this.nuncaResponde) return new Promise(() => {});
    if (this.indisponivel) {
      return Promise.resolve({
        vectors: textos.map(() => null),
        available: false,
        reason: this.indisponivel,
      });
    }
    return Promise.resolve({
      vectors: textos.map((t) => this.vetorPorTexto.get(t) ?? angulo(89)),
      available: true,
      uso: {
        inputTokens: textos.length * 10,
        estimated: false,
        model: 'nomic-embed-text:latest',
      },
    });
  }
}

class FakeUsage {
  gravadas: Record<string, unknown>[] = [];
  falhar = false;
  execute(input: Record<string, unknown>) {
    if (this.falhar) return Promise.reject(new Error('banco fora'));
    this.gravadas.push(input);
    return Promise.resolve({});
  }
}

class FakeAppend {
  eventos: {
    type: string;
    actor: unknown;
    payload: Record<string, unknown>;
  }[] = [];
  falhar = false;
  execute(
    _p: string,
    _s: string,
    input: { type: string; actor: unknown; payload: Record<string, unknown> },
  ) {
    if (this.falhar) return Promise.reject(new Error('sessão sumiu'));
    this.eventos.push(input);
    return Promise.resolve({});
  }
}

let stories: FakeStories;
let events: FakeEvents;
let models: FakeModels;
let embeddings: FakeEmbeddings;
let usage: FakeUsage;
let append: FakeAppend;
let useCase: VerificarDuplicataSemanticaUseCase;

beforeEach(() => {
  stories = new FakeStories();
  events = new FakeEvents();
  models = new FakeModels();
  embeddings = new FakeEmbeddings();
  usage = new FakeUsage();
  append = new FakeAppend();
  useCase = new VerificarDuplicataSemanticaUseCase(
    stories as unknown as StoryRepository,
    events as unknown as SessionEventRepository,
    models as unknown as ModelRepository,
    embeddings as unknown as RagEmbeddingService,
    usage as unknown as RecordLlmUsageUseCase,
    append as unknown as AppendSessionEventUseCase,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

const NOVA = 'Endpoint GET /hello público que devolve saudação imediata';
const VELHA = 'Endpoint público de saudação determinística';

function storyCheck(title = NOVA) {
  return useCase.execute({
    projectId: PROJECT,
    sessionId: SESSION,
    kind: 'story',
    itemId: 'story-nova',
    title,
  });
}

describe('VerificarDuplicataSemanticaUseCase (RN-681)', () => {
  it('AVISA quando a mais próxima passa do limiar — evento no log, frase ao agente', async () => {
    stories.existentes = [
      { id: 'story-velha', title: VELHA, createdAt: new Date(1) },
      {
        id: 'story-outra',
        title: 'Cadastro de usuário',
        createdAt: new Date(2),
      },
    ];
    // cos(10°) ≈ 0,985 ≥ 0,8; cos(80°) ≈ 0,17.
    embeddings.vetorPorTexto.set(NOVA, angulo(0));
    embeddings.vetorPorTexto.set(VELHA, angulo(10));
    embeddings.vetorPorTexto.set('Cadastro de usuário', angulo(80));

    const r = await storyCheck();

    expect(r.status).toBe('warned');
    if (r.status !== 'warned') throw new Error('inalcançável');
    expect(r.similarTo).toEqual({ id: 'story-velha', title: VELHA });
    expect(r.similarity).toBeCloseTo(Math.cos((10 * Math.PI) / 180), 3);
    expect(r.threshold).toBe(LIMIAR_DE_DUPLICATA_SEMANTICA);
    expect(r.message).toMatch(/AVISO \(não é recusa\)/);
    expect(r.message).toContain(VELHA);

    expect(append.eventos).toHaveLength(1);
    expect(append.eventos[0].type).toBe('backlog.semantic_duplicate_warned');
    expect(append.eventos[0].actor).toEqual(ATOR_DA_DUPLICATA_SEMANTICA);
    expect(append.eventos[0].payload).toMatchObject({
      kind: 'story',
      itemId: 'story-nova',
      similarToId: 'story-velha',
    });
  });

  it('o gasto entra no metering como LINHA PRÓPRIA — ator system, saída zero, preço do catálogo', async () => {
    stories.existentes = [
      { id: 'story-velha', title: VELHA, createdAt: new Date(1) },
    ];

    await storyCheck();

    expect(usage.gravadas).toHaveLength(1);
    expect(usage.gravadas[0]).toMatchObject({
      projectId: PROJECT,
      sessionId: SESSION,
      actor: { kind: 'system', id: 'duplicata-semantica' },
      provider: 'ollama',
      modelId: 'm-nomic',
      modelName: 'nomic-embed-text:latest',
      inputTokens: 20,
      outputTokens: 0,
      // 20 tokens × 20 000 micros/1M = 0,4 → arredonda para 0.
      costMicros: 0,
      inputPricePerMillionMicros: 20_000,
      outputPricePerMillionMicros: 0,
    });
  });

  it('abaixo do limiar NÃO avisa e não narra nada — mas o gasto é medido', async () => {
    stories.existentes = [
      {
        id: 'story-outra',
        title: 'Cadastro de usuário',
        createdAt: new Date(1),
      },
    ];
    embeddings.vetorPorTexto.set(NOVA, angulo(0));
    embeddings.vetorPorTexto.set('Cadastro de usuário', angulo(60)); // 0,5

    const r = await storyCheck();

    expect(r.status).toBe('clean');
    expect(r.message).toBeNull();
    expect(append.eventos).toHaveLength(0);
    expect(usage.gravadas).toHaveLength(1);
  });

  it('SEM provider de embedding: PULA, diz o motivo no log e ao agente, não lança e não mede', async () => {
    stories.existentes = [
      { id: 'story-velha', title: VELHA, createdAt: new Date(1) },
    ];
    embeddings.indisponivel =
      'provider "ollama" não declara a capability embeddings';

    const r = await storyCheck();

    expect(r).toMatchObject({
      status: 'skipped',
      reason: 'provider "ollama" não declara a capability embeddings',
    });
    expect(r.message).toMatch(/PULADA/);
    expect(append.eventos.map((e) => e.type)).toEqual([
      'backlog.semantic_duplicate_check_skipped',
    ]);
    expect(append.eventos[0].payload.reason).toContain('capability');
    expect(usage.gravadas).toHaveLength(0);
  });

  it('daemon que não responde: pula pelo teto de tempo, nomeando-o', async () => {
    vi.useFakeTimers();
    stories.existentes = [
      { id: 'story-velha', title: VELHA, createdAt: new Date(1) },
    ];
    embeddings.nuncaResponde = true;

    const promessa = storyCheck();
    await vi.advanceTimersByTimeAsync(TETO_DE_TEMPO_DA_CHECAGEM_MS + 1);
    const r = await promessa;

    expect(r).toMatchObject({ status: 'skipped' });
    if (r.status !== 'skipped') throw new Error('inalcançável');
    expect(r.reason).toMatch(/não respondeu em 10 s/);
    expect(append.eventos[0].type).toBe(
      'backlog.semantic_duplicate_check_skipped',
    );
  });

  it('projeto sem outra história: nada a comparar, nenhum embedding chamado', async () => {
    stories.existentes = [
      // O próprio item recém-gravado não conta.
      { id: 'story-nova', title: NOVA, createdAt: new Date(1) },
    ];

    const r = await storyCheck();

    expect(r.status).toBe('nothing_to_compare');
    expect(embeddings.chamadas).toHaveLength(0);
    expect(append.eventos).toHaveLength(0);
    expect(usage.gravadas).toHaveLength(0);
  });

  it('compara só as mais recentes até o teto, e DIZ quantas ficaram de fora', async () => {
    const n = TETO_DE_COMPARACOES_DE_DUPLICATA + 5;
    stories.existentes = Array.from({ length: n }, (_, i) => ({
      id: `s${i}`,
      title: `História ${i}`,
      createdAt: new Date(i),
    }));
    embeddings.vetorPorTexto.set(NOVA, angulo(0));

    const r = await storyCheck();

    // Título novo + as TETO mais recentes, num lote só.
    expect(embeddings.chamadas[0]).toHaveLength(
      TETO_DE_COMPARACOES_DE_DUPLICATA + 1,
    );
    expect(embeddings.chamadas[0]).not.toContain('História 0');
    expect(embeddings.chamadas[0]).toContain(`História ${n - 1}`);
    expect(r).toMatchObject({
      status: 'clean',
      compared: TETO_DE_COMPARACOES_DE_DUPLICATA,
      total: n,
    });
    expect(r.message).toContain(
      `${TETO_DE_COMPARACOES_DE_DUPLICATA} mais recentes de ${n}`,
    );
  });

  it('regra de negócio: compara com os eventos do projeto, fora a própria e as sem título', async () => {
    events.regras = [
      { id: 'evt-velha', payload: { title: VELHA }, createdAt: new Date(1) },
      { id: 'evt-sem', payload: { description: 'x' }, createdAt: new Date(2) },
      { id: 'evt-nova', payload: { title: NOVA }, createdAt: new Date(3) },
    ];
    embeddings.vetorPorTexto.set(NOVA, angulo(0));
    embeddings.vetorPorTexto.set(VELHA, angulo(5));

    const r = await useCase.execute({
      projectId: PROJECT,
      sessionId: SESSION,
      kind: 'business_rule',
      itemId: null,
      title: NOVA,
    });

    expect(embeddings.chamadas[0]).toEqual([NOVA, VELHA]);
    expect(r.status).toBe('warned');
    expect(r.message).toMatch(/regra de negócio parece duplicar/);
  });

  it('metering e log que falham NÃO derrubam a checagem', async () => {
    stories.existentes = [
      { id: 'story-velha', title: VELHA, createdAt: new Date(1) },
    ];
    embeddings.vetorPorTexto.set(NOVA, angulo(0));
    embeddings.vetorPorTexto.set(VELHA, angulo(1));
    usage.falhar = true;
    append.falhar = true;

    const r = await storyCheck();

    expect(r.status).toBe('warned');
  });
});
