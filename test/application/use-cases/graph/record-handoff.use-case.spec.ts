import { describe, expect, it, vi } from 'vitest';
import { RecordHandoffUseCase } from '../../../../src/application/use-cases/graph/record-handoff.use-case';
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
  sessionId: 'sess-1',
  seq: 42,
  fromAgent: 'po',
  toAgent: 'arquiteto',
};

describe('RecordHandoffUseCase', () => {
  it('caminho feliz: MERGE pela chave natural (sessionId, seq)', async () => {
    const run = vi.fn<GraphTx['run']>().mockResolvedValue({ records: [] });
    const useCase = new RecordHandoffUseCase(fakeGraphStore({ run }));

    await useCase.execute(INPUT);

    expect(run).toHaveBeenCalledTimes(1);
    const [cypher, params] = run.mock.calls[0];
    expect(cypher).toMatch(
      /MERGE \(h:Handoff \{sessionId: \$sessionId, seq: \$seq\}\)/,
    );
    expect(params).toEqual(INPUT);
  });

  it('idempotência: reprocessar o MESMO evento (replay) manda os mesmos parâmetros de chave', async () => {
    const run = vi.fn<GraphTx['run']>().mockResolvedValue({ records: [] });
    const useCase = new RecordHandoffUseCase(fakeGraphStore({ run }));

    await useCase.execute(INPUT);
    await useCase.execute(INPUT);

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0][1]).toEqual(run.mock.calls[1][1]);
  });

  it('degradação: GraphStore indisponível propaga GraphUnavailableError', async () => {
    const graph = {
      executeWrite: () =>
        Promise.reject(new GraphUnavailableError('Neo4j fora do ar.')),
      executeRead: () =>
        Promise.reject(new GraphUnavailableError('Neo4j fora do ar.')),
    } as unknown as GraphStore;
    const useCase = new RecordHandoffUseCase(graph);

    await expect(useCase.execute(INPUT)).rejects.toBeInstanceOf(
      GraphUnavailableError,
    );
  });
});
