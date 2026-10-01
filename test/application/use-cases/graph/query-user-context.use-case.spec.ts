import { describe, expect, it, vi } from 'vitest';
import { QueryUserContextUseCase } from '../../../../src/application/use-cases/graph/query-user-context.use-case';
import { GraphUnavailableError } from '../../../../src/domain/graph/graph-errors';
import type {
  GraphStore,
  GraphTx,
} from '../../../../src/infrastructure/graph/graph-store';

function fakeRecord(props: Record<string, unknown>) {
  return { get: <T>(key: string) => props[key] as T };
}

function fakeGraphStore(tx: GraphTx): GraphStore {
  return {
    executeWrite: (work: (tx: GraphTx) => unknown) => Promise.resolve(work(tx)),
    executeRead: (work: (tx: GraphTx) => unknown) => Promise.resolve(work(tx)),
  } as unknown as GraphStore;
}

describe('QueryUserContextUseCase', () => {
  it('caminho feliz: compõe hipóteses, perfis e handoffs das três leituras', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        records: [
          fakeRecord({
            id: 'hyp-1',
            descricao: 'prefere respostas curtas',
            status: 'ativa',
            evidenceSeqs: [5, 8],
          }),
        ],
      })
      .mockResolvedValueOnce({
        records: [
          fakeRecord({ dimensao: 'backend', proficiencia: 'avancado' }),
        ],
      })
      .mockResolvedValueOnce({
        records: [
          fakeRecord({
            sessionId: 'sess-1',
            seq: 42,
            fromAgent: 'po',
            toAgent: 'arquiteto',
          }),
        ],
      })
      .mockResolvedValueOnce({
        records: [
          fakeRecord({
            total: 1,
            fatos: [
              {
                hypothesisId: 'hyp-9',
                agenteAlvo: 'po',
                hipotese: 'prefere uma pergunta por vez',
                sugestao: 'o PO pergunta uma coisa de cada vez',
                aceitoEm: '2026-10-01T10:00:00.000Z',
              },
            ],
          }),
        ],
      });
    const useCase = new QueryUserContextUseCase(fakeGraphStore({ run }));

    const resultado = await useCase.execute({
      userId: 'user-1',
      projectId: 'proj-1',
    });

    expect(resultado.hypotheses).toEqual([
      {
        id: 'hyp-1',
        descricao: 'prefere respostas curtas',
        status: 'ativa',
        evidenceSeqs: [5, 8],
      },
    ]);
    expect(resultado.profiles).toEqual([
      { dimensao: 'backend', proficiencia: 'avancado' },
    ]);
    expect(resultado.recentHandoffs).toEqual([
      { sessionId: 'sess-1', seq: 42, fromAgent: 'po', toAgent: 'arquiteto' },
    ]);
    expect(resultado.facts).toEqual([
      {
        hypothesisId: 'hyp-9',
        agenteAlvo: 'po',
        hipotese: 'prefere uma pergunta por vez',
        sugestao: 'o PO pergunta uma coisa de cada vez',
        aceitoEm: '2026-10-01T10:00:00.000Z',
      },
    ]);
    expect(resultado.factsTotal).toBe(1);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('RN-680: os fatos são lidos ESCOPADOS ao projeto e com o teto pedido', async () => {
    const run = vi.fn().mockResolvedValue({ records: [] });
    const useCase = new QueryUserContextUseCase(fakeGraphStore({ run }));

    await useCase.execute({ userId: 'u-1', projectId: 'p-1', factLimit: 3 });

    const [cypher, params] = run.mock.calls[3] as [
      string,
      Record<string, unknown>,
    ];
    expect(cypher).toContain('FatoDoPerfil');
    expect(cypher).toContain(':NO_PROJETO]->(:Projeto {id: $projectId})');
    expect(params).toEqual({ userId: 'u-1', projectId: 'p-1', factLimit: 3 });
  });

  it('caminho feliz: usuário sem nada no grafo devolve listas vazias, não erro', async () => {
    const run = vi.fn().mockResolvedValue({ records: [] });
    const useCase = new QueryUserContextUseCase(fakeGraphStore({ run }));

    const resultado = await useCase.execute({
      userId: 'user-sem-historico',
      projectId: 'proj-1',
    });

    expect(resultado).toEqual({
      hypotheses: [],
      profiles: [],
      recentHandoffs: [],
      facts: [],
      factsTotal: 0,
    });
  });

  it('degradação: GraphStore indisponível propaga GraphUnavailableError', async () => {
    const graph = {
      executeWrite: () =>
        Promise.reject(new GraphUnavailableError('Neo4j fora do ar.')),
      executeRead: () =>
        Promise.reject(new GraphUnavailableError('Neo4j fora do ar.')),
    } as unknown as GraphStore;
    const useCase = new QueryUserContextUseCase(graph);

    await expect(
      useCase.execute({ userId: 'user-1', projectId: 'proj-1' }),
    ).rejects.toBeInstanceOf(GraphUnavailableError);
  });
});
