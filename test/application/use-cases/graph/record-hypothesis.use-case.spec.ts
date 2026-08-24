import { describe, expect, it, vi } from 'vitest';
import { RecordHypothesisUseCase } from '../../../../src/application/use-cases/graph/record-hypothesis.use-case';
import { GraphUnavailableError } from '../../../../src/domain/graph/graph-errors';
import type {
  GraphStore,
  GraphTx,
} from '../../../../src/infrastructure/graph/graph-store';

function fakeGraphStore(tx: GraphTx): GraphStore {
  return {
    executeWrite: (work: (tx: GraphTx) => unknown) => Promise.resolve(work(tx)),
    executeRead: (work: (tx: GraphTx) => unknown) => Promise.resolve(work(tx)),
  } as unknown as GraphStore;
}

const INPUT = {
  hypothesisId: 'hyp-1',
  sessionId: 'sess-1',
  descricao: 'o usuário prefere respostas curtas',
  status: 'ativa' as const,
  evidenceSeqs: [5, 8, 12],
};

describe('RecordHypothesisUseCase', () => {
  it('caminho feliz: MERGE por id (não por sessionId+seq), com as evidências em UNWIND', async () => {
    const run = vi.fn<GraphTx['run']>().mockResolvedValue({ records: [] });
    const useCase = new RecordHypothesisUseCase(fakeGraphStore({ run }));

    await useCase.execute(INPUT);

    expect(run).toHaveBeenCalledTimes(1);
    const [cypher, params] = run.mock.calls[0];
    expect(cypher).toMatch(/MERGE \(h:Hipotese \{id: \$hypothesisId\}\)/);
    expect(cypher).toMatch(/UNWIND \$evidenceSeqs AS seq/);
    expect(params).toEqual(INPUT);
  });

  it('idempotência: reprocessar a MESMA hipótese (replay) não muda os parâmetros da chave', async () => {
    const run = vi.fn<GraphTx['run']>().mockResolvedValue({ records: [] });
    const useCase = new RecordHypothesisUseCase(fakeGraphStore({ run }));

    await useCase.execute(INPUT);
    await useCase.execute(INPUT);

    expect(run).toHaveBeenCalledTimes(2);
    const [, params1] = run.mock.calls[0];
    const [, params2] = run.mock.calls[1];
    expect(params1?.hypothesisId).toBe(params2?.hypothesisId);
  });

  it('degradação: GraphStore indisponível propaga GraphUnavailableError', async () => {
    const graph = {
      executeWrite: () =>
        Promise.reject(new GraphUnavailableError('Neo4j fora do ar.')),
      executeRead: () =>
        Promise.reject(new GraphUnavailableError('Neo4j fora do ar.')),
    } as unknown as GraphStore;
    const useCase = new RecordHypothesisUseCase(graph);

    await expect(useCase.execute(INPUT)).rejects.toBeInstanceOf(
      GraphUnavailableError,
    );
  });
});
