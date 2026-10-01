import { describe, expect, it, vi } from 'vitest';
import { RecordProfileFactUseCase } from '../../../../src/application/use-cases/graph/record-profile-fact.use-case';
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
  userId: 'user-1',
  projectId: 'proj-1',
  agenteAlvo: 'po',
  hipotese: 'prefere uma pergunta por vez',
  sugestao: 'o PO pergunta uma coisa de cada vez',
  aceitoEm: '2026-10-01T10:00:00.000Z',
};

describe('RecordProfileFactUseCase (RN-680)', () => {
  it('caminho feliz: MERGE pela hipótese aceita, ligado à pessoa e ao projeto', async () => {
    const run = vi.fn<GraphTx['run']>().mockResolvedValue({ records: [] });
    const useCase = new RecordProfileFactUseCase(fakeGraphStore({ run }));

    await useCase.execute(INPUT);

    expect(run).toHaveBeenCalledTimes(1);
    const [cypher, params] = run.mock.calls[0];
    expect(cypher).toMatch(
      /MERGE \(f:FatoDoPerfil \{hypothesisId: \$hypothesisId\}\)/,
    );
    expect(cypher).toContain('MERGE (f)-[:SOBRE]->(u)');
    expect(cypher).toContain('MERGE (f)-[:NO_PROJETO]->(p)');
    expect(params).toEqual(INPUT);
  });

  it('degradação: GraphStore indisponível propaga GraphUnavailableError', async () => {
    const graph = {
      executeWrite: () =>
        Promise.reject(new GraphUnavailableError('Neo4j fora do ar.')),
    } as unknown as GraphStore;
    const useCase = new RecordProfileFactUseCase(graph);

    await expect(useCase.execute(INPUT)).rejects.toBeInstanceOf(
      GraphUnavailableError,
    );
  });
});
