import { describe, it, expect, vi } from 'vitest';
import { ApplyInstructionVersionService } from '../../../../src/application/use-cases/instructions/apply-instruction-version.service';
import type { AgentInstructionRepository } from '../../../../src/application/ports/agent-instruction-repository.port';
import type { AgentInstructionVersionRepository } from '../../../../src/application/ports/agent-instruction-version-repository.port';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { AgentInstructionVersion } from '../../../../src/domain/instructions/agent-instruction-version.entity';

const now = new Date();

function buildHarness(opts: {
  current?: { version: number; content: string } | null;
  history?: AgentInstructionVersion[];
  invalidateThrows?: boolean;
}) {
  const current = opts.current === undefined ? null : opts.current;
  const history = opts.history ?? [];

  // Espelha o comportamento real do upsert: conteúdo idêntico não bumpa.
  const upsert = vi.fn((input: { content: string }) =>
    Promise.resolve(
      current && current.content === input.content
        ? { version: current.version, content: current.content }
        : {
            version: (current?.version ?? 0) + 1,
            content: input.content,
          },
    ),
  );
  const instructions = {
    findByProjectAndAgent: () =>
      Promise.resolve(
        current
          ? {
              id: 'ai-1',
              projectId: 'proj-1',
              agent: 'dev-api',
              content: current.content,
              version: current.version,
              createdAt: now,
              updatedAt: now,
            }
          : null,
      ),
    upsert,
  } as unknown as AgentInstructionRepository;

  const createVersion = vi.fn((input: Record<string, unknown>) =>
    Promise.resolve({ id: `ver-${input.version as number}`, ...input }),
  );
  const versions = {
    listByAgent: () => Promise.resolve(history),
    create: createVersion,
  } as unknown as AgentInstructionVersionRepository;

  const invalidateInstructions = vi.fn(() =>
    opts.invalidateThrows
      ? Promise.reject(new Error('engine fora do ar'))
      : Promise.resolve(),
  );
  const engineClient = {
    invalidateInstructions,
  } as unknown as ApiToEngineClient;

  return {
    service: new ApplyInstructionVersionService(
      instructions,
      versions,
      engineClient,
    ),
    upsert,
    createVersion,
    invalidateInstructions,
  };
}

describe('ApplyInstructionVersionService', () => {
  it('primeira instrução (sem current): grava versão e invalida cache', async () => {
    const { service, createVersion, invalidateInstructions } = buildHarness({});

    const result = await service.apply({
      projectId: 'proj-1',
      agent: 'dev-api',
      content: 'nova instrução',
    });

    expect(result.changed).toBe(true);
    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(1);
    expect(result.cacheInvalidated).toBe(true);
    expect(invalidateInstructions).toHaveBeenCalledWith('proj-1', 'dev-api');
    expect(createVersion).toHaveBeenCalledTimes(1);
  });

  it('backfill retroativo: captura o conteúdo vigente como versão antes de sobrescrever', async () => {
    // Cenário real de tudo que foi semeado antes da Fase 4b: existe
    // instrução v3 mas nenhuma linha de histórico. Sem o backfill, o
    // primeiro rollback não teria pra onde voltar.
    const { service, createVersion } = buildHarness({
      current: { version: 3, content: 'instrução antiga' },
      history: [],
    });

    await service.apply({
      projectId: 'proj-1',
      agent: 'dev-api',
      content: 'instrução nova',
    });

    expect(createVersion).toHaveBeenCalledTimes(2);
    expect(createVersion).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ version: 3, content: 'instrução antiga' }),
    );
    expect(createVersion).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ version: 4, content: 'instrução nova' }),
    );
  });

  it('com histórico já existente, não faz backfill', async () => {
    const { service, createVersion } = buildHarness({
      current: { version: 3, content: 'antiga' },
      history: [{ version: 3 } as AgentInstructionVersion],
    });

    await service.apply({
      projectId: 'proj-1',
      agent: 'dev-api',
      content: 'nova',
    });

    expect(createVersion).toHaveBeenCalledTimes(1);
    expect(createVersion).toHaveBeenCalledWith(
      expect.objectContaining({ version: 4 }),
    );
  });

  it('conteúdo idêntico ao vigente: nada muda, sem versão nem invalidação', async () => {
    const { service, createVersion, invalidateInstructions } = buildHarness({
      current: { version: 2, content: 'igual' },
      history: [{ version: 2 } as AgentInstructionVersion],
    });

    const result = await service.apply({
      projectId: 'proj-1',
      agent: 'dev-api',
      content: 'igual',
    });

    expect(result.changed).toBe(false);
    expect(createVersion).not.toHaveBeenCalled();
    expect(invalidateInstructions).not.toHaveBeenCalled();
  });

  it('falha ao invalidar o cache NÃO desfaz o patch (best-effort)', async () => {
    const { service, createVersion } = buildHarness({
      current: { version: 1, content: 'antiga' },
      history: [{ version: 1 } as AgentInstructionVersion],
      invalidateThrows: true,
    });

    const result = await service.apply({
      projectId: 'proj-1',
      agent: 'dev-api',
      content: 'nova',
    });

    expect(result.changed).toBe(true);
    expect(result.cacheInvalidated).toBe(false);
    expect(createVersion).toHaveBeenCalled();
  });

  it('propaga sourceHypothesisId pra versão (rastreabilidade hipótese→patch→versão)', async () => {
    const { service, createVersion } = buildHarness({
      current: { version: 1, content: 'antiga' },
      history: [{ version: 1 } as AgentInstructionVersion],
    });

    await service.apply({
      projectId: 'proj-1',
      agent: 'dev-api',
      content: 'nova',
      sourceActionId: 'action-9',
      sourceHypothesisId: 'hyp-7',
    });

    expect(createVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceActionId: 'action-9',
        sourceHypothesisId: 'hyp-7',
      }),
    );
  });
});
