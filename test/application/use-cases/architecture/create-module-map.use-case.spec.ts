import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CreateModuleMapUseCase } from '../../../../src/application/use-cases/architecture/create-module-map.use-case';
import type { StoryRepository } from '../../../../src/application/ports/backlog-repository.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { Story } from '../../../../src/domain/backlog/backlog.entity';
import type {
  ModuleMap,
  ModuleNode,
} from '../../../../src/domain/architecture/module-map.entity';

const PROJECT = 'p1';
const SESSION = 's1';

function mod(name: string, dependsOn: string[] = []): ModuleNode {
  return { name, stack: 'ts', responsibility: name, dependsOn };
}

function story(overrides: Partial<Story>): Story {
  return {
    id: 's1',
    epicId: 'e1',
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

class FakeModuleMaps {
  current: ModuleMap | null = null;
  created: ModuleMap | null = null;
  findCurrent() {
    return Promise.resolve(this.current);
  }
  create(input: { modules: ModuleNode[]; version: number }) {
    this.created = {
      id: 'mm-new',
      projectId: PROJECT,
      sessionId: SESSION,
      modules: input.modules,
      version: input.version,
      createdAt: new Date(),
    };
    return Promise.resolve(this.created);
  }
}

class FakeStories {
  rows: Story[] = [];
  demoted: string[] = [];
  findByProject() {
    return Promise.resolve(this.rows);
  }
  updateStatus(id: string, status: string) {
    this.demoted.push(`${id}:${status}`);
    return Promise.resolve(story({ id, status: status as Story['status'] }));
  }
}

class FakeAppend {
  calls: string[] = [];
  execute(_p: string, _s: string, input: { type: string }) {
    this.calls.push(input.type);
    return Promise.resolve({} as never);
  }
}

let maps: FakeModuleMaps;
let stories: FakeStories;
let append: FakeAppend;
let useCase: CreateModuleMapUseCase;

beforeEach(() => {
  maps = new FakeModuleMaps();
  stories = new FakeStories();
  append = new FakeAppend();
  useCase = new CreateModuleMapUseCase(
    maps,
    stories as unknown as StoryRepository,
    append as unknown as AppendSessionEventUseCase,
  );
});

describe('CreateModuleMapUseCase', () => {
  it('rejeita module_map com ciclo — nada é criado', async () => {
    await expect(
      useCase.execute(PROJECT, SESSION, {
        modules: [mod('a', ['b']), mod('b', ['a'])],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(maps.created).toBeNull();
    expect(append.calls).toHaveLength(0);
  });

  it('versiona (version+1) quando o mapa anterior é de OUTRA sessão', async () => {
    // Sessão diferente: revisar a arquitetura numa sessão nova é o caso que o
    // versionamento existe para servir.
    maps.current = {
      id: 'old',
      projectId: PROJECT,
      sessionId: 'sessao-anterior',
      modules: [],
      version: 3,
      createdAt: new Date(),
    };
    const map = await useCase.execute(PROJECT, SESSION, {
      modules: [mod('api'), mod('web', ['api'])],
    });
    expect(map.version).toBe(4);
    expect(append.calls).toContain('artifact.module_map');
  });

  /**
   * Dentro da MESMA sessão, a segunda emissão nunca é revisão — é o modelo
   * redecidindo do zero. Numa execução real o Arquiteto emitiu quatro mapas
   * seguidos, com recortes diferentes a cada volta (`greeting`, `hello_core`,
   * `greeting`, `hello-api-core`), e só parou porque a rede caiu.
   */
  it('recusa o SEGUNDO mapa da mesma sessão, dizendo o que fazer em seguida', async () => {
    maps.current = {
      id: 'atual',
      projectId: PROJECT,
      sessionId: SESSION,
      modules: [mod('api')],
      version: 1,
      createdAt: new Date(),
    };

    await expect(
      useCase.execute(PROJECT, SESSION, { modules: [mod('outro')] }),
    ).rejects.toThrow(/já definiu o module_map/);

    // E não grava nada: nem mapa, nem evento.
    expect(append.calls).not.toContain('artifact.module_map');
  });

  /**
   * A recusa precisa dizer os NOMES, não a contagem.
   *
   * O Arquiteto não tem ferramenta para ler o module_map vigente. Enquanto a
   * mensagem era "(2 módulos)", ele lia que o mapa existia, continuava sem
   * saber como chamar os módulos, e reemitia o mapa justamente para tentar
   * fixá-los — o laço era sintoma da cegueira. Com os nomes, a recusa vira a
   * resposta da pergunta que ele estava fazendo.
   */
  it('a recusa diz QUAIS são os módulos, não quantos', async () => {
    maps.current = {
      id: 'atual',
      projectId: PROJECT,
      sessionId: SESSION,
      modules: [mod('saudacao'), mod('api_http')],
      version: 1,
      createdAt: new Date(),
    };

    await expect(
      useCase.execute(PROJECT, SESSION, { modules: [mod('outro')] }),
    ).rejects.toThrow(/saudacao, api_http/);
  });

  it('revalida: rebaixa a story ready cujo módulo sumiu, com evento', async () => {
    stories.rows = [
      story({ id: 's-orfa', status: 'ready', moduleIds: ['sumiu'] }),
      story({ id: 's-ok', status: 'ready', moduleIds: ['api'] }),
      story({ id: 's-draft', status: 'draft', moduleIds: ['sumiu'] }),
    ];
    await useCase.execute(PROJECT, SESSION, { modules: [mod('api')] });

    // Só a ready órfã é rebaixada; a ok (módulo existe) e a draft não.
    expect(stories.demoted).toEqual(['s-orfa:draft']);
    expect(append.calls).toContain('backlog.story_demoted');
  });
});
