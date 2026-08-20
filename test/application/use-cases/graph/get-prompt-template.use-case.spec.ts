import { describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { GetPromptTemplateUseCase } from '../../../../src/application/use-cases/graph/get-prompt-template.use-case';
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

const VERSAO = {
  name: 'dev-agent-kickoff',
  version: '3',
  body: 'você é o dev agent...',
  hash: 'sha256:abc',
  createdAt: { toString: () => '2026-08-19T00:00:00Z' },
  active: true,
};

describe('GetPromptTemplateUseCase', () => {
  it('caminho feliz: version específica encontrada', async () => {
    const run = () =>
      Promise.resolve({ records: [fakeRecord({ versao: VERSAO })] });
    const useCase = new GetPromptTemplateUseCase(fakeGraphStore({ run }));

    const resultado = await useCase.execute({
      name: VERSAO.name,
      version: '3',
    });

    expect(resultado.version).toBe('3');
    expect(resultado.createdAt).toBe('2026-08-19T00:00:00Z');
  });

  it('caminho feliz: sem version, busca a ativa mais recente', async () => {
    const run = () =>
      Promise.resolve({ records: [fakeRecord({ versao: VERSAO })] });
    const useCase = new GetPromptTemplateUseCase(fakeGraphStore({ run }));

    const resultado = await useCase.execute({ name: VERSAO.name });

    expect(resultado.active).toBe(true);
  });

  it('falha: template inexistente devolve NotFoundException (404)', async () => {
    const run = () => Promise.resolve({ records: [] });
    const useCase = new GetPromptTemplateUseCase(fakeGraphStore({ run }));

    await expect(
      useCase.execute({ name: 'nao-existe' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('falha: version específica inexistente devolve NotFoundException (404)', async () => {
    const run = () => Promise.resolve({ records: [] });
    const useCase = new GetPromptTemplateUseCase(fakeGraphStore({ run }));

    await expect(
      useCase.execute({ name: VERSAO.name, version: '99' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('degradação: GraphStore indisponível propaga GraphUnavailableError', async () => {
    const graph = {
      executeWrite: () =>
        Promise.reject(new GraphUnavailableError('Neo4j fora do ar.')),
      executeRead: () =>
        Promise.reject(new GraphUnavailableError('Neo4j fora do ar.')),
    } as unknown as GraphStore;
    const useCase = new GetPromptTemplateUseCase(graph);

    await expect(useCase.execute({ name: VERSAO.name })).rejects.toBeInstanceOf(
      GraphUnavailableError,
    );
  });
});
