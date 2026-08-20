import { describe, expect, it, vi } from 'vitest';
import { RecordAnamneseProfileUseCase } from '../../../../src/application/use-cases/graph/record-anamnese-profile.use-case';
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
  dimensao: 'backend',
  proficiencia: 'avancado',
};

describe('RecordAnamneseProfileUseCase', () => {
  it('caminho feliz: MERGE pela chave natural (userId, dimensao)', async () => {
    const run = vi.fn<GraphTx['run']>().mockResolvedValue({ records: [] });
    const useCase = new RecordAnamneseProfileUseCase(fakeGraphStore({ run }));

    await useCase.execute(INPUT);

    expect(run).toHaveBeenCalledTimes(1);
    const [cypher, params] = run.mock.calls[0];
    expect(cypher).toMatch(
      /MERGE \(p:PerfilAnamnese \{userId: \$userId, dimensao: \$dimensao\}\)/,
    );
    expect(params).toEqual(INPUT);
  });

  it('idempotência: uma rodada nova SOBRESCREVE a proficiência (snapshot vigente, não histórico)', async () => {
    const run = vi.fn<GraphTx['run']>().mockResolvedValue({ records: [] });
    const useCase = new RecordAnamneseProfileUseCase(fakeGraphStore({ run }));

    await useCase.execute(INPUT);
    await useCase.execute({ ...INPUT, proficiencia: 'especialista' });

    expect(run).toHaveBeenCalledTimes(2);
    const [, params] = run.mock.calls[1];
    expect(params?.proficiencia).toBe('especialista');
  });

  it('degradação: GraphStore indisponível propaga GraphUnavailableError', async () => {
    const graph = {
      executeWrite: () =>
        Promise.reject(new GraphUnavailableError('Neo4j fora do ar.')),
      executeRead: () =>
        Promise.reject(new GraphUnavailableError('Neo4j fora do ar.')),
    } as unknown as GraphStore;
    const useCase = new RecordAnamneseProfileUseCase(graph);

    await expect(useCase.execute(INPUT)).rejects.toBeInstanceOf(
      GraphUnavailableError,
    );
  });
});
