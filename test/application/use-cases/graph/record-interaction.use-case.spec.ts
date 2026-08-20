import { describe, expect, it, vi } from 'vitest';
import { RecordInteractionUseCase } from '../../../../src/application/use-cases/graph/record-interaction.use-case';
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
  userId: 'user-1',
  projectId: 'proj-1',
  sessionId: 'sess-1',
  seqInicio: 10,
  seqFim: 20,
};

describe('RecordInteractionUseCase', () => {
  it('caminho feliz: grava a Interacao pela chave natural sessionId, numa única escrita', async () => {
    const run = vi.fn<GraphTx['run']>().mockResolvedValue({ records: [] });
    const useCase = new RecordInteractionUseCase(fakeGraphStore({ run }));

    await useCase.execute(INPUT);

    expect(run).toHaveBeenCalledTimes(1);
    const [cypher, params] = run.mock.calls[0];
    // A Interacao é casada/criada ANTES de qualquer relação — MERGE isolado
    // pela chave natural, não como parte do padrão (u)-[:PARTICIPOU]->(i).
    expect(cypher).toMatch(/MERGE \(i:Interacao \{sessionId: \$sessionId\}\)/);
    expect(params).toEqual(INPUT);
  });

  it('idempotência: reprocessar o MESMO intervalo (replay) manda os mesmos parâmetros — o MERGE por sessionId é quem garante que não duplica', async () => {
    const run = vi.fn<GraphTx['run']>().mockResolvedValue({ records: [] });
    const useCase = new RecordInteractionUseCase(fakeGraphStore({ run }));

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
    const useCase = new RecordInteractionUseCase(graph);

    await expect(useCase.execute(INPUT)).rejects.toBeInstanceOf(
      GraphUnavailableError,
    );
  });
});
