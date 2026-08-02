import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ReturnStoryUseCase } from '../../../../src/application/use-cases/backlog/return-story.use-case';
import type { StoryRepository } from '../../../../src/application/ports/backlog-repository.port';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { Story } from '../../../../src/domain/backlog/backlog.entity';

const PROJECT = 'p1';
const USER = 'u-42';
const MOTIVO = 'Os critérios de aceite não cobrem a recusa do pagamento.';

// Registra a ordem das operações — é o que prova que a chamada ao engine
// acontece FORA da transação.
let ordem: string[];

const uowStub = {
  runInTransaction: async <T>(work: () => Promise<T>) => {
    ordem.push('tx:inicio');
    const r = await work();
    ordem.push('tx:fim');
    return r;
  },
};

function makeStory(overrides: Partial<Story> = {}): Story {
  return {
    id: 'story-1',
    epicId: 'epic-1',
    projectId: PROJECT,
    sessionId: 's1',
    title: 'Cadastro',
    description: '',
    rf: ['rf'],
    rnf: [],
    businessRuleIds: ['evt-r1'],
    dod: ['dod'],
    dor: ['dor'],
    moduleIds: [],
    status: 'draft',
    proposedReady: true,
    returnedReason: null,
    returnedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

class FakeStories {
  story: Story | null = makeStory();
  devolvida: { id: string; reason: string } | null = null;
  findById() {
    return Promise.resolve(this.story);
  }
  markReturned(id: string, reason: string) {
    ordem.push('markReturned');
    this.devolvida = { id, reason };
    return Promise.resolve(
      makeStory({ ...this.story!, proposedReady: false, returnedReason: reason }),
    );
  }
}

class FakeAppend {
  eventos: { sessionId: string; type: string; actor: unknown; payload: unknown }[] =
    [];
  execute(
    _p: string,
    sessionId: string,
    input: { type: string; actor: unknown; payload: unknown },
  ) {
    ordem.push('evento');
    this.eventos.push({ sessionId, ...input });
    return Promise.resolve({} as never);
  }
}

class FakeEngine {
  chamadas: unknown[] = [];
  falhar = false;
  reviseStory(...args: unknown[]) {
    ordem.push('engine');
    if (this.falhar) return Promise.reject(new Error('PO não está de pé'));
    this.chamadas.push(args);
    return Promise.resolve();
  }
}

let stories: FakeStories;
let append: FakeAppend;
let engine: FakeEngine;
let useCase: ReturnStoryUseCase;

beforeEach(() => {
  ordem = [];
  stories = new FakeStories();
  append = new FakeAppend();
  engine = new FakeEngine();
  useCase = new ReturnStoryUseCase(
    stories as unknown as StoryRepository,
    append as unknown as AppendSessionEventUseCase,
    engine as unknown as ApiToEngineClient,
    uowStub,
  );
});

describe('ReturnStoryUseCase (Fase 12c — RN-048)', () => {
  it('grava o motivo, registra o evento e avisa o PO', async () => {
    const r = await useCase.execute(PROJECT, 'story-1', MOTIVO, USER);

    expect(r).toEqual({ ok: true });
    expect(stories.devolvida).toEqual({ id: 'story-1', reason: MOTIVO });
    expect(append.eventos).toEqual([
      {
        sessionId: 's1',
        type: 'backlog.story_promotion_returned',
        actor: { kind: 'user', id: USER },
        payload: { storyId: 'story-1', title: 'Cadastro', reason: MOTIVO },
      },
    ]);
    expect(engine.chamadas).toEqual([
      [PROJECT, 's1', 'story-1', 'Cadastro', MOTIVO],
    ]);
  });

  it('o engine é chamado DEPOIS da transação fechar', async () => {
    // Um round-trip HTTP segurando conexão do pool esgota o pool sob carga —
    // a mesma razão pela qual o comentário no gate ficou fora da transação.
    await useCase.execute(PROJECT, 'story-1', MOTIVO, USER);

    expect(ordem).toEqual([
      'tx:inicio',
      'markReturned',
      'evento',
      'tx:fim',
      'engine',
    ]);
  });

  it('PO morto NÃO desfaz a recusa — a decisão é do usuário', async () => {
    // O oposto do `RearmDevAgentUseCase`, que fala com o engine antes: lá o
    // evento é uma afirmação SOBRE O ENGINE; aqui é sobre o usuário, e é
    // verdade tenha ou não um agente ouvindo.
    engine.falhar = true;

    const r = await useCase.execute(PROJECT, 'story-1', MOTIVO, USER);

    expect(r).toEqual({ ok: true });
    expect(stories.devolvida).toEqual({ id: 'story-1', reason: MOTIVO });
    expect(append.eventos).toHaveLength(1);
  });

  it('história de outro projeto é 404 e nada é gravado', async () => {
    stories.story = makeStory({ projectId: 'outro' });

    await expect(
      useCase.execute(PROJECT, 'story-1', MOTIVO, USER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(stories.devolvida).toBeNull();
    expect(append.eventos).toEqual([]);
    expect(ordem).toEqual([]);
  });
});
