import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AssignStoryModulesUseCase } from '../../../../src/application/use-cases/architecture/assign-story-modules.use-case';
import type { StoryRepository } from '../../../../src/application/ports/backlog-repository.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { Story } from '../../../../src/domain/backlog/backlog.entity';
import type {
  ModuleMap,
  ModuleNode,
} from '../../../../src/domain/architecture/module-map.entity';

/**
 * A recusa desta ferramenta é a ÚNICA fonte de verdade que o Arquiteto tem
 * sobre os nomes dos módulos: ele não tem ferramenta para ler o module_map
 * vigente.
 *
 * Numa execução real, com a mensagem listando só o que estava errado, ele
 * partiu para força bruta — 18 chutes em sequência (`api`, `core`, `http`,
 * `greeting`, `domain`, `web`, `hello-api`, `hello`, `greeting-api`,
 * `saudacao`, `app`, `server`, `publico`, `public-api`, `api-publica`, …) até
 * acertar um por sorte. As quatro histórias terminaram no MESMO módulo,
 * inclusive a do endpoint, e o desfecho afirmou que estava tudo certo.
 *
 * Por isso o que se afirma aqui não é "recusa": é que a recusa ENSINA.
 */

const PROJECT = 'p1';
const SESSION = 's1';

function mod(name: string): ModuleNode {
  return { name, stack: 'ts', responsibility: name, dependsOn: [] };
}

function story(overrides: Partial<Story> = {}): Story {
  return {
    id: 'story-1',
    epicId: 'e1',
    projectId: PROJECT,
    sessionId: SESSION,
    title: 'Endpoint público de saudação',
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

class FakeStories {
  row: Story | null = story();
  updated: { id: string; moduleIds: string[] } | null = null;
  findById() {
    return Promise.resolve(this.row);
  }
  updateModules(id: string, moduleIds: string[]) {
    this.updated = { id, moduleIds };
    return Promise.resolve(story({ id, moduleIds }));
  }
}

class FakeModuleMaps {
  current: ModuleMap | null = null;
  findCurrent() {
    return Promise.resolve(this.current);
  }
}

class FakeAppend {
  calls: string[] = [];
  execute(_p: string, _s: string, input: { type: string }) {
    this.calls.push(input.type);
    return Promise.resolve({} as never);
  }
}

function mapaCom(...nomes: string[]): ModuleMap {
  return {
    id: 'mm',
    projectId: PROJECT,
    sessionId: SESSION,
    modules: nomes.map(mod),
    version: 1,
    createdAt: new Date(),
  };
}

let stories: FakeStories;
let maps: FakeModuleMaps;
let append: FakeAppend;
let useCase: AssignStoryModulesUseCase;

beforeEach(() => {
  stories = new FakeStories();
  maps = new FakeModuleMaps();
  append = new FakeAppend();
  useCase = new AssignStoryModulesUseCase(
    stories as unknown as StoryRepository,
    maps,
    append as unknown as AppendSessionEventUseCase,
  );
});

describe('AssignStoryModulesUseCase', () => {
  it('vincula quando todos os módulos existem', async () => {
    maps.current = mapaCom('saudacao', 'api_http');

    await useCase.execute(PROJECT, SESSION, {
      storyId: 'story-1',
      moduleIds: ['api_http'],
    });

    expect(stories.updated).toEqual({ id: 'story-1', moduleIds: ['api_http'] });
    expect(append.calls).toContain('backlog.story_modules_assigned');
  });

  it('a recusa lista os módulos VÁLIDOS, não só os inexistentes', async () => {
    maps.current = mapaCom('saudacao', 'api_http');

    await expect(
      useCase.execute(PROJECT, SESSION, {
        storyId: 'story-1',
        moduleIds: ['api', 'core'],
      }),
    ).rejects.toThrow(/válidos são: saudacao, api_http/);
  });

  it('a recusa também diz o que estava errado', async () => {
    maps.current = mapaCom('saudacao', 'api_http');

    await expect(
      useCase.execute(PROJECT, SESSION, {
        storyId: 'story-1',
        moduleIds: ['api', 'core'],
      }),
    ).rejects.toThrow(/inexistentes no module_map vigente: api, core/);
  });

  /**
   * Sem mapa nenhum não existem "nomes válidos" para oferecer, e uma lista
   * vazia lê-se como "chute de novo". O caminho tem que nomear o problema
   * REAL — falta o passo 1 do kickoff.
   */
  it('sem module_map, manda criar o mapa em vez de listar nada', async () => {
    maps.current = null;

    await expect(
      useCase.execute(PROJECT, SESSION, {
        storyId: 'story-1',
        moduleIds: ['api'],
      }),
    ).rejects.toThrow(/Nenhum module_map foi definido ainda/);
  });

  it('nada é gravado quando a recusa acontece', async () => {
    maps.current = mapaCom('saudacao');

    await expect(
      useCase.execute(PROJECT, SESSION, {
        storyId: 'story-1',
        moduleIds: ['api'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(stories.updated).toBeNull();
    expect(append.calls).toHaveLength(0);
  });

  it('história de outro projeto não é encontrada', async () => {
    stories.row = story({ projectId: 'outro-projeto' });
    maps.current = mapaCom('saudacao');

    await expect(
      useCase.execute(PROJECT, SESSION, {
        storyId: 'story-1',
        moduleIds: ['saudacao'],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
