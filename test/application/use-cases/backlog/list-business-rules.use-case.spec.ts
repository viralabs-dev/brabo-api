import { describe, it, expect } from 'vitest';
import { ListBusinessRulesUseCase } from '../../../../src/application/use-cases/backlog/list-business-rules.use-case';
import type { StoryRepository } from '../../../../src/application/ports/backlog-repository.port';
import type { SessionEventRepository } from '../../../../src/application/ports/session-event-repository.port';
import type { SessionEvent } from '../../../../src/domain/sessions/session-event.entity';
import type { Story } from '../../../../src/domain/backlog/backlog.entity';

/**
 * RN-164 — o que o PO lê antes de escrever.
 *
 * O que estes testes travam é a diferença entre esta leitura e a cobertura da
 * tela (`GetCoverageUseCase`): aqui a `description` VAI JUNTO, porque é dela
 * que sai o RF da história. Um relatório com título e sem conteúdo deixaria o
 * PO exatamente onde ele estava — sabendo que a regra existe e não o que ela
 * diz.
 */

const PROJETO = 'p1';

function regra(id: string, title: string, description: string): SessionEvent {
  return {
    id,
    sessionId: 's1',
    seq: 1,
    type: 'artifact.business_rule',
    actor: { kind: 'agent', id: 'criativo' },
    payload: { title, description },
    createdAt: new Date(),
  };
}

function historia(id: string, businessRuleIds: string[]): Story {
  return {
    id,
    epicId: 'ep-1',
    projectId: PROJETO,
    sessionId: 's1',
    title: `história ${id}`,
    description: '',
    rf: [],
    rnf: [],
    businessRuleIds,
    dod: [],
    dor: [],
    moduleIds: [],
    status: 'draft',
    proposedReady: false,
    returnedReason: null,
    returnedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function montar(eventos: SessionEvent[], historias: Story[]) {
  const sessionEvents = {
    listByTypeForProject: (projectId: string, type: string) => {
      expect(projectId).toBe(PROJETO);
      expect(type).toBe('artifact.business_rule');
      return Promise.resolve(eventos);
    },
  } as unknown as SessionEventRepository;

  const stories = {
    findByProject: () => Promise.resolve(historias),
  } as unknown as StoryRepository;

  return new ListBusinessRulesUseCase(sessionEvents, stories);
}

describe('ListBusinessRulesUseCase', () => {
  it('devolve id, título, descrição e a cobertura de cada regra', async () => {
    const caso = montar(
      [
        regra('evt-1', 'Só maiores de 18', 'idade >= 18'),
        regra('evt-2', 'Carrinho tem teto', 'no máximo 50 itens'),
      ],
      [historia('st-1', ['evt-2'])],
    );

    const relatorio = await caso.execute(PROJETO);

    expect(relatorio.uncoveredCount).toBe(1);
    expect(relatorio.rules).toEqual([
      {
        id: 'evt-1',
        title: 'Só maiores de 18',
        description: 'idade >= 18',
        coveredByStoryIds: [],
        covered: false,
      },
      {
        id: 'evt-2',
        title: 'Carrinho tem teto',
        description: 'no máximo 50 itens',
        coveredByStoryIds: ['st-1'],
        covered: true,
      },
    ]);
  });

  it('projeto sem regra nenhuma responde vazio, não erro', async () => {
    const caso = montar([], []);

    await expect(caso.execute(PROJETO)).resolves.toEqual({
      rules: [],
      uncoveredCount: 0,
    });
  });

  it('regra com payload capenga não derruba a leitura inteira', async () => {
    // O payload de evento é `unknown` no domínio, e evento é IMUTÁVEL: um
    // artefato antigo, gravado antes de o schema fechar, não pode ser
    // corrigido nem apagado. Degradar campo a campo é a única saída que não
    // esconde as outras regras do PO.
    const capenga = {
      ...regra('evt-3', 'x', 'y'),
      payload: null,
    } as SessionEvent;

    const caso = montar([capenga], []);
    const relatorio = await caso.execute(PROJETO);

    expect(relatorio.rules).toEqual([
      {
        id: 'evt-3',
        title: '(regra sem título)',
        description: '',
        coveredByStoryIds: [],
        covered: false,
      },
    ]);
  });
});
