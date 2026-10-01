import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CreateStoryUseCase } from '../../../../src/application/use-cases/backlog/create-story.use-case';
import type {
  StoryRepository,
  EpicRepository,
} from '../../../../src/application/ports/backlog-repository.port';
import type { SessionEventRepository } from '../../../../src/application/ports/session-event-repository.port';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import type { ModuleMapRepository } from '../../../../src/application/ports/module-map-repository.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { VerificarDuplicataSemanticaUseCase } from '../../../../src/application/use-cases/backlog/verificar-duplicata-semantica.use-case';
import type {
  Story,
  Epic,
} from '../../../../src/domain/backlog/backlog.entity';
import type { SessionEvent } from '../../../../src/domain/sessions/session-event.entity';

const PROJECT = 'p1';
const SESSION = 's1';

function makeStory(overrides: Partial<Story> = {}): Story {
  return {
    id: 'story-1',
    epicId: 'epic-1',
    projectId: PROJECT,
    sessionId: SESSION,
    title: 't',
    description: '',
    rf: [],
    rnf: [],
    businessRuleIds: [],
    dod: [],
    dor: [],
    moduleIds: [],
    status: 'draft',
    proposedReady: false,
    returnedReason: null,
    returnedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

class FakeEpics {
  epic: Epic | null = {
    id: 'epic-1',
    projectId: PROJECT,
    sessionId: SESSION,
    title: 'e',
    description: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  findById() {
    return Promise.resolve(this.epic);
  }
}

class FakeStories {
  created: Story | null = null;
  status: string | null = null;
  proposed: boolean | null = null;
  // As histórias que o projeto JÁ tem — vazio por padrão, que é o cenário
  // dos testes herdados. Quem testa duplicata/sobreposição preenche.
  existentes: Story[] = [];
  findByProject() {
    return Promise.resolve(this.existentes);
  }
  create(input: Partial<Story>) {
    this.created = makeStory({ ...input, id: 'story-1' });
    return Promise.resolve(this.created);
  }
  updateStatus(_id: string, status: string) {
    this.status = status;
    this.created = makeStory({
      ...this.created!,
      status: status as Story['status'],
    });
    return Promise.resolve(this.created);
  }
  setProposedReady(_id: string, proposed: boolean) {
    this.proposed = proposed;
    this.created = makeStory({ ...this.created!, proposedReady: proposed });
    return Promise.resolve(this.created);
  }
}

class FakeProjects {
  storyPromotion: 'manual' | 'auto' = 'auto';
  findById() {
    return Promise.resolve({
      id: PROJECT,
      storyPromotion: this.storyPromotion,
    });
  }
}

class FakeModuleMaps {
  current: { modules: { name: string }[] } | null = null;
  findCurrent() {
    return Promise.resolve(this.current);
  }
}

class FakeEvents {
  byId: Record<string, SessionEvent> = {};
  findById(id: string) {
    return Promise.resolve(this.byId[id] ?? null);
  }
}

class FakeAppend {
  calls: string[] = [];
  execute(_p: string, _s: string, input: { type: string }) {
    this.calls.push(input.type);
    return Promise.resolve({} as never);
  }
}

function ruleEvent(id: string): SessionEvent {
  return {
    id,
    sessionId: SESSION,
    seq: 1,
    type: 'artifact.business_rule',
    actor: { kind: 'agent', id: 'criativo' },
    payload: { title: 'regra' },
    createdAt: new Date(),
  };
}

let epics: FakeEpics;
let stories: FakeStories;
let events: FakeEvents;
let append: FakeAppend;
let projects: FakeProjects;
let moduleMaps: FakeModuleMaps;
let duplicata: FakeDuplicata;
let useCase: CreateStoryUseCase;

// A checagem semântica (RN-681) tem spec própria; aqui interessa só que a
// criação a chama DEPOIS de gravar, com o id gravado, e devolve o desfecho.
class FakeDuplicata {
  chamadas: { kind: string; itemId: string; title: string }[] = [];
  resposta: unknown = { status: 'nothing_to_compare', message: null };
  execute(input: { kind: string; itemId: string; title: string }) {
    this.chamadas.push({
      kind: input.kind,
      itemId: input.itemId,
      title: input.title,
    });
    return Promise.resolve(this.resposta);
  }
}

function build() {
  return new CreateStoryUseCase(
    stories as unknown as StoryRepository,
    epics as unknown as EpicRepository,
    events as unknown as SessionEventRepository,
    append as unknown as AppendSessionEventUseCase,
    projects as unknown as ProjectRepository,
    moduleMaps as unknown as ModuleMapRepository,
    duplicata as unknown as VerificarDuplicataSemanticaUseCase,
  );
}

beforeEach(() => {
  epics = new FakeEpics();
  stories = new FakeStories();
  events = new FakeEvents();
  append = new FakeAppend();
  projects = new FakeProjects();
  moduleMaps = new FakeModuleMaps();
  duplicata = new FakeDuplicata();
  // Os testes herdados da Fase 3b descrevem o modo `auto` — que era o único
  // comportamento até a 12c. Ficam como estão, provando que o opt-in não
  // mudou nada para quem o escolhe.
  projects.storyPromotion = 'auto';
  useCase = build();
});

describe('CreateStoryUseCase', () => {
  it('recusa business_rule_id inexistente — nada é criado', async () => {
    await expect(
      useCase.execute(PROJECT, SESSION, {
        epicId: 'epic-1',
        title: 'Cadastro',
        businessRuleIds: ['nao-existe'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(stories.created).toBeNull();
    expect(append.calls).toHaveLength(0);
  });

  it('recusa id que existe mas NÃO é artifact.business_rule', async () => {
    events.byId['evt-x'] = { ...ruleEvent('evt-x'), type: 'chat.message' };
    await expect(
      useCase.execute(PROJECT, SESSION, {
        epicId: 'epic-1',
        title: 'x',
        businessRuleIds: ['evt-x'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('modo auto: story completa é criada e promovida a ready', async () => {
    events.byId['evt-r1'] = ruleEvent('evt-r1');
    const story = await useCase.execute(PROJECT, SESSION, {
      epicId: 'epic-1',
      title: 'Cadastro',
      rf: ['permitir cadastro'],
      dod: ['testes'],
      dor: ['aceite'],
      businessRuleIds: ['evt-r1'],
    });
    expect(story.status).toBe('ready');
    expect(stories.status).toBe('ready');
    expect(append.calls).toEqual(['backlog.story_created']);
  });

  it('modo auto: story incompleta permanece draft', async () => {
    events.byId['evt-r1'] = ruleEvent('evt-r1');
    const story = await useCase.execute(PROJECT, SESSION, {
      epicId: 'epic-1',
      title: 'Sem DoD',
      rf: ['rf'],
      dor: ['aceite'],
      businessRuleIds: ['evt-r1'],
      // sem dod
    });
    expect(story.status).toBe('draft');
    expect(stories.status).toBeNull();
  });

  it('recusa épico inexistente no projeto', async () => {
    epics.epic = null;
    await expect(
      useCase.execute(PROJECT, SESSION, { epicId: 'nope', title: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('modo manual (default da Fase 12c — RN-048)', () => {
    beforeEach(() => {
      projects.storyPromotion = 'manual';
      useCase = build();
    });

    it('story completa NÃO vai a ready — fica draft, proposta ao usuário', async () => {
      // O coração da fase: `status` continua `draft`, então nenhuma task
      // desta story é pegável pelo claim (que exige `s.status = ready`) até
      // o usuário decidir.
      events.byId['evt-r1'] = ruleEvent('evt-r1');

      const story = await useCase.execute(PROJECT, SESSION, {
        epicId: 'epic-1',
        title: 'Cadastro',
        rf: ['permitir cadastro'],
        dod: ['testes'],
        dor: ['aceite'],
        businessRuleIds: ['evt-r1'],
      });

      expect(story.status).toBe('draft');
      expect(story.proposedReady).toBe(true);
      expect(stories.status).toBeNull();
      expect(append.calls).toEqual([
        'backlog.story_created',
        'backlog.story_promotion_proposed',
      ]);
    });

    it('story INCOMPLETA não é proposta — não empurra o trabalho do PO pro usuário', async () => {
      events.byId['evt-r1'] = ruleEvent('evt-r1');

      const story = await useCase.execute(PROJECT, SESSION, {
        epicId: 'epic-1',
        title: 'Sem DoD',
        rf: ['rf'],
        dor: ['aceite'],
        businessRuleIds: ['evt-r1'],
      });

      expect(story.status).toBe('draft');
      expect(story.proposedReady).toBe(false);
      expect(stories.proposed).toBeNull();
      expect(append.calls).toEqual(['backlog.story_created']);
    });

    it('módulo inexistente no module_map impede a proposta — mesma validação do modo auto', async () => {
      // Requisito 3: o modo muda QUEM dispara, nunca O QUE é validado.
      events.byId['evt-r1'] = ruleEvent('evt-r1');
      moduleMaps.current = { modules: [{ name: 'api' }] };
      stories.create = (input: Partial<Story>) => {
        stories.created = makeStory({
          ...input,
          id: 'story-1',
          moduleIds: ['fantasma'],
        });
        return Promise.resolve(stories.created);
      };

      const story = await useCase.execute(PROJECT, SESSION, {
        epicId: 'epic-1',
        title: 'Com módulo fantasma',
        rf: ['rf'],
        dod: ['dod'],
        dor: ['dor'],
        businessRuleIds: ['evt-r1'],
      });

      expect(story.proposedReady).toBe(false);
    });
  });
  // Achado R: o PO gerou "Endpoint público de saudação determinística" e
  // "Endpoint público GET /hello que responde saudação imediata" para o
  // mesmo endpoint, sem dedupe nem aviso.
  describe('história repetida (achado R)', () => {
    it('recusa título idêntico no projeto — nada é criado', async () => {
      stories.existentes = [
        makeStory({ id: 'story-velha', title: 'Endpoint público de saudação' }),
      ];

      await expect(
        useCase.execute(PROJECT, SESSION, {
          epicId: 'epic-1',
          title: 'Endpoint público de saudação',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(stories.created).toBeNull();
      expect(append.calls).toHaveLength(0);
    });

    it('caixa e acento diferentes ainda são o mesmo título', async () => {
      stories.existentes = [
        makeStory({ id: 'story-velha', title: 'Endpoint público de saudação' }),
      ];

      await expect(
        useCase.execute(PROJECT, SESSION, {
          epicId: 'epic-1',
          title: '  ENDPOINT PUBLICO DE SAUDACAO  ',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('avisa quando a nova história não acrescenta cobertura — mas CRIA', async () => {
      events.byId['evt-r1'] = ruleEvent('evt-r1');
      stories.existentes = [
        makeStory({
          id: 'story-velha',
          title: 'Saudação determinística',
          businessRuleIds: ['evt-r1', 'evt-r2'],
        }),
      ];

      const story = await useCase.execute(PROJECT, SESSION, {
        epicId: 'epic-1',
        title: 'GET /hello responde saudação imediata',
        businessRuleIds: ['evt-r1'],
      });

      // A história EXISTE: o aviso não bloqueia. Quem decide é o usuário.
      expect(story).not.toBeNull();
      expect(append.calls).toContain('backlog.story_overlap_warned');
    });

    it('regra em comum, mas cobertura NOVA, não vira aviso', async () => {
      events.byId['evt-r1'] = ruleEvent('evt-r1');
      events.byId['evt-r9'] = ruleEvent('evt-r9');
      stories.existentes = [
        makeStory({ id: 'story-velha', businessRuleIds: ['evt-r1'] }),
      ];

      await useCase.execute(PROJECT, SESSION, {
        epicId: 'epic-1',
        title: 'Outra coisa',
        businessRuleIds: ['evt-r1', 'evt-r9'],
      });

      // Compartilhar UMA regra é normal; avisar disso seria ruído.
      expect(append.calls).not.toContain('backlog.story_overlap_warned');
    });

    it('história sem regra citada não gera aviso', async () => {
      stories.existentes = [
        makeStory({ id: 'story-velha', businessRuleIds: ['evt-r1'] }),
      ];

      await useCase.execute(PROJECT, SESSION, {
        epicId: 'epic-1',
        title: 'Sem justificativa',
      });

      expect(append.calls).not.toContain('backlog.story_overlap_warned');
    });

    it('projeto vazio: primeira história nunca é duplicata nem aviso', async () => {
      events.byId['evt-r1'] = ruleEvent('evt-r1');

      const story = await useCase.execute(PROJECT, SESSION, {
        epicId: 'epic-1',
        title: 'A primeira',
        businessRuleIds: ['evt-r1'],
      });

      expect(story).not.toBeNull();
      expect(append.calls).not.toContain('backlog.story_overlap_warned');
    });
  });

  // RN-681 (AT-171): o par do achado R, que o título e a justificativa não
  // ligam, é o que a checagem SEMÂNTICA existe para pegar — e ela só avisa.
  describe('duplicata semântica (RN-681)', () => {
    it('chama a checagem com a história GRAVADA e devolve o aviso — a história existe', async () => {
      duplicata.resposta = {
        status: 'warned',
        similarTo: {
          id: 'story-velha',
          title: 'Endpoint público de saudação determinística',
        },
        similarity: 0.91,
        threshold: 0.8,
        compared: 1,
        total: 1,
        message: 'AVISO (não é recusa): ...',
      };

      const story = await useCase.execute(PROJECT, SESSION, {
        epicId: 'epic-1',
        title: 'Endpoint GET /hello público que devolve saudação imediata',
      });

      expect(stories.created).not.toBeNull();
      expect(duplicata.chamadas).toEqual([
        {
          kind: 'story',
          itemId: 'story-1',
          title: 'Endpoint GET /hello público que devolve saudação imediata',
        },
      ]);
      expect(story.semanticDuplicate.status).toBe('warned');
    });

    it('título idêntico continua RECUSADO antes — a checagem semântica nem roda', async () => {
      stories.existentes = [
        makeStory({ id: 'story-velha', title: 'Endpoint público de saudação' }),
      ];

      await expect(
        useCase.execute(PROJECT, SESSION, {
          epicId: 'epic-1',
          title: 'Endpoint público de saudação',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(duplicata.chamadas).toHaveLength(0);
    });
  });
});
