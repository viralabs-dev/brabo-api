import { describe, it, expect, beforeEach } from 'vitest';
import { PromoteStoriesUseCase } from '../../../../src/application/use-cases/backlog/promote-stories.use-case';
import { TransitionStoryUseCase } from '../../../../src/application/use-cases/backlog/transition-story.use-case';
import type {
  StoryRepository,
  TaskRepository,
} from '../../../../src/application/ports/backlog-repository.port';
import type { ModuleMapRepository } from '../../../../src/application/ports/module-map-repository.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { Story } from '../../../../src/domain/backlog/backlog.entity';

// Reentrante e passa-direto, como o DrizzleUnitOfWork quando já há tx ativa —
// que é exatamente a situação aqui: o Promote abre a transação e o Transition
// reusa a mesma.
const uowStub = {
  runInTransaction: <T>(work: () => Promise<T>) => work(),
};

const PROJECT = 'p1';
const USER = 'u-42';

function makeStory(overrides: Partial<Story> = {}): Story {
  return {
    id: 'story-1',
    epicId: 'epic-1',
    projectId: PROJECT,
    sessionId: 's1',
    title: 't',
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
  byId = new Map<string, Story>();
  propostaDesligada: string[] = [];
  promovidas: string[] = [];

  findById(id: string) {
    return Promise.resolve(this.byId.get(id) ?? null);
  }
  updateStatus(id: string, status: string) {
    this.promovidas.push(id);
    const atual = this.byId.get(id)!;
    const nova = makeStory({ ...atual, status: status as Story['status'] });
    this.byId.set(id, nova);
    return Promise.resolve(nova);
  }
  setProposedReady(id: string, proposed: boolean) {
    if (!proposed) this.propostaDesligada.push(id);
    const nova = makeStory({ ...this.byId.get(id)!, proposedReady: proposed });
    this.byId.set(id, nova);
    return Promise.resolve(nova);
  }
}

class FakeAppend {
  eventos: { sessionId: string; type: string; actor: unknown }[] = [];
  execute(
    _p: string,
    sessionId: string,
    input: { type: string; actor: unknown },
  ) {
    this.eventos.push({ sessionId, type: input.type, actor: input.actor });
    return Promise.resolve({} as never);
  }
}

class FakeModuleMaps {
  findCurrent() {
    return Promise.resolve(null);
  }
}

class FakeTasks {
  findByStoryIds() {
    return Promise.resolve([]);
  }
}

class FakeOutbox {
  calls: { eventType: string; aggregateId: string }[] = [];
  append(input: { eventType: string; aggregateId: string }) {
    this.calls.push(input);
    return Promise.resolve();
  }
}

let stories: FakeStories;
let append: FakeAppend;
let outbox: FakeOutbox;
let useCase: PromoteStoriesUseCase;

beforeEach(() => {
  stories = new FakeStories();
  append = new FakeAppend();
  outbox = new FakeOutbox();

  const transition = new TransitionStoryUseCase(
    stories as unknown as StoryRepository,
    new FakeModuleMaps() as unknown as ModuleMapRepository,
    append as unknown as AppendSessionEventUseCase,
    new FakeTasks() as unknown as TaskRepository,
    outbox,
    uowStub,
  );

  useCase = new PromoteStoriesUseCase(
    stories as unknown as StoryRepository,
    transition,
    uowStub,
  );
});

describe('PromoteStoriesUseCase (Fase 12c — RN-048)', () => {
  it('promove e desliga a proposta na mesma passada', async () => {
    stories.byId.set('story-1', makeStory());

    const resultado = await useCase.execute(PROJECT, ['story-1'], USER);

    expect(resultado).toEqual({ promoted: ['story-1'], failed: [] });
    expect(stories.promovidas).toEqual(['story-1']);
    // Sem isto a história ficaria para sempre na seção "aguardando sua
    // promoção" já estando `ready` — uma pendência que não existe mais.
    expect(stories.propostaDesligada).toEqual(['story-1']);
    expect(stories.byId.get('story-1')!.proposedReady).toBe(false);
  });

  it('o evento registra o USUÁRIO como quem promoveu', async () => {
    stories.byId.set('story-1', makeStory());

    await useCase.execute(PROJECT, ['story-1'], USER);

    expect(append.eventos).toEqual([
      {
        sessionId: 's1',
        type: 'backlog.story_transitioned',
        actor: { kind: 'user', id: USER },
      },
    ]);
  });

  it('lote: uma história impromovível não derruba as outras', async () => {
    // O caso que motiva `failed` existir: entre a proposta do PO e a decisão
    // do usuário, alguém esvaziou o DoD de uma delas.
    stories.byId.set('story-1', makeStory({ id: 'story-1' }));
    stories.byId.set('story-2', makeStory({ id: 'story-2', dod: [] }));
    stories.byId.set('story-3', makeStory({ id: 'story-3' }));

    const resultado = await useCase.execute(
      PROJECT,
      ['story-1', 'story-2', 'story-3'],
      USER,
    );

    expect(resultado.promoted).toEqual(['story-1', 'story-3']);
    expect(resultado.failed).toHaveLength(1);
    expect(resultado.failed[0].storyId).toBe('story-2');
    expect(resultado.failed[0].reason).toBeTruthy();
    expect(stories.promovidas).toEqual(['story-1', 'story-3']);
  });

  it('individual é lote de 1 — mesmo caminho, mesmo formato de resposta', async () => {
    stories.byId.set('story-1', makeStory({ dod: [] }));

    const resultado = await useCase.execute(PROJECT, ['story-1'], USER);

    expect(resultado.promoted).toEqual([]);
    expect(resultado.failed).toHaveLength(1);
  });

  it('história de outro projeto não é promovida pela rota deste', async () => {
    stories.byId.set('story-1', makeStory({ projectId: 'outro' }));

    const resultado = await useCase.execute(PROJECT, ['story-1'], USER);

    expect(resultado.promoted).toEqual([]);
    expect(resultado.failed[0].reason).toContain('não encontrada');
    expect(stories.promovidas).toEqual([]);
  });

  it('cada história vai para a sessão em que NASCEU, não para uma da rota', async () => {
    // Um lote pode misturar histórias de sessões diferentes; cada evento tem
    // de cair na linha do tempo onde o trabalho aconteceu.
    stories.byId.set('story-1', makeStory({ id: 'story-1', sessionId: 's1' }));
    stories.byId.set('story-2', makeStory({ id: 'story-2', sessionId: 's2' }));

    await useCase.execute(PROJECT, ['story-1', 'story-2'], USER);

    expect(append.eventos.map((e) => e.sessionId)).toEqual(['s1', 's2']);
  });
});
