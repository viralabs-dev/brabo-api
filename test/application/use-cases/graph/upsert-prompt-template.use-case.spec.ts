import { describe, expect, it, vi } from 'vitest';
import { UpsertPromptTemplateUseCase } from '../../../../src/application/use-cases/graph/upsert-prompt-template.use-case';
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

const INPUT = {
  name: 'dev-agent-kickoff',
  version: '3',
  body: 'você é o dev agent...',
  hash: 'sha256:abc',
};

describe('UpsertPromptTemplateUseCase', () => {
  it('caminho feliz: hash inédito cria versão nova (created: true)', async () => {
    const run = vi
      .fn()
      // 1ª chamada: busca por hash — não encontra.
      .mockResolvedValueOnce({ records: [] })
      // 2ª chamada: cria e devolve a versão nova.
      .mockResolvedValueOnce({
        records: [
          fakeRecord({
            versao: {
              name: INPUT.name,
              version: INPUT.version,
              body: INPUT.body,
              hash: INPUT.hash,
              createdAt: { toString: () => '2026-08-19T00:00:00Z' },
              active: true,
            },
          }),
        ],
      });
    const graph = fakeGraphStore({ run });
    const useCase = new UpsertPromptTemplateUseCase(graph);

    const resultado = await useCase.execute(INPUT);

    expect(resultado.created).toBe(true);
    expect(resultado.template).toEqual({
      name: INPUT.name,
      version: INPUT.version,
      body: INPUT.body,
      hash: INPUT.hash,
      createdAt: '2026-08-19T00:00:00Z',
      active: true,
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('idempotência: hash já existente devolve a versão existente (created: false), sem criar nada', async () => {
    const run = vi.fn().mockResolvedValueOnce({
      records: [
        fakeRecord({
          versao: {
            name: INPUT.name,
            version: '2',
            body: INPUT.body,
            hash: INPUT.hash,
            createdAt: { toString: () => '2026-08-18T00:00:00Z' },
            active: false,
          },
        }),
      ],
    });
    const graph = fakeGraphStore({ run });
    const useCase = new UpsertPromptTemplateUseCase(graph);

    const resultado = await useCase.execute(INPUT);

    expect(resultado.created).toBe(false);
    expect(resultado.template.version).toBe('2');
    // SÓ a busca por hash rodou — nenhuma escrita de versão nova.
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('degradação: GraphStore indisponível propaga GraphUnavailableError', async () => {
    const graph = {
      executeWrite: () =>
        Promise.reject(new GraphUnavailableError('Neo4j fora do ar.')),
      executeRead: () =>
        Promise.reject(new GraphUnavailableError('Neo4j fora do ar.')),
    } as unknown as GraphStore;
    const useCase = new UpsertPromptTemplateUseCase(graph);

    await expect(useCase.execute(INPUT)).rejects.toBeInstanceOf(
      GraphUnavailableError,
    );
  });
});
