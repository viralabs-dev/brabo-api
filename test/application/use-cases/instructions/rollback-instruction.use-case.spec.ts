import { describe, it, expect, vi } from 'vitest';
import { RollbackInstructionUseCase } from '../../../../src/application/use-cases/instructions/rollback-instruction.use-case';
import type { AgentInstructionVersionRepository } from '../../../../src/application/ports/agent-instruction-version-repository.port';
import type { SessionRepository } from '../../../../src/application/ports/session-repository.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { ApplyInstructionVersionService } from '../../../../src/application/use-cases/instructions/apply-instruction-version.service';
import type { AgentInstructionVersion } from '../../../../src/domain/instructions/agent-instruction-version.entity';

const now = new Date();

function version(
  overrides: Partial<AgentInstructionVersion> = {},
): AgentInstructionVersion {
  return {
    id: 'ver-1',
    projectId: 'proj-1',
    agent: 'dev-api',
    version: 1,
    content: 'instrução original',
    createdBy: null,
    sourceActionId: null,
    sourceHypothesisId: null,
    note: null,
    createdAt: now,
    ...overrides,
  };
}

function buildHarness(opts: {
  target?: AgentInstructionVersion | null;
  changed?: boolean;
  hasSession?: boolean;
}) {
  const target = opts.target === undefined ? version() : opts.target;

  const versions = {
    findVersion: () => Promise.resolve(target),
  } as unknown as AgentInstructionVersionRepository;

  const sessions = {
    listForProject: () =>
      Promise.resolve(
        opts.hasSession === false
          ? []
          : [{ id: 'sess-1', createdAt: now } as never],
      ),
  } as unknown as SessionRepository;

  const appendEvent = vi.fn(() => Promise.resolve({}));
  const appendSessionEvent = {
    execute: appendEvent,
  } as unknown as AppendSessionEventUseCase;

  const apply = vi.fn(() =>
    Promise.resolve({
      fromVersion: 4,
      toVersion: 5,
      versionId: 'ver-5',
      changed: opts.changed ?? true,
      cacheInvalidated: true,
    }),
  );
  const applyInstruction = {
    apply,
  } as unknown as ApplyInstructionVersionService;

  return {
    useCase: new RollbackInstructionUseCase(
      versions,
      sessions,
      appendSessionEvent,
      applyInstruction,
    ),
    apply,
    appendEvent,
  };
}

describe('RollbackInstructionUseCase', () => {
  it('rollback grava uma versão NOVA com o conteúdo antigo (append-only, nada é apagado)', async () => {
    const { useCase, apply } = buildHarness({});

    const result = await useCase.execute('proj-1', 'dev-api', 1, 'user-1');

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'instrução original',
        createdBy: 'user-1',
        note: 'rollback para a versão 1',
      }),
    );
    expect(result.restoredFrom).toBe(1);
    expect(result.toVersion).toBe(5);
    expect(result.cacheInvalidated).toBe(true);
  });

  it('preserva a origem da versão restaurada (rastreabilidade sobrevive ao rollback)', async () => {
    const { useCase, apply } = buildHarness({
      target: version({ sourceHypothesisId: 'hyp-7' }),
    });

    await useCase.execute('proj-1', 'dev-api', 1, 'user-1');

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ sourceHypothesisId: 'hyp-7' }),
    );
  });

  it('narra instruction.rolled_back no event log', async () => {
    const { useCase, appendEvent } = buildHarness({});

    await useCase.execute('proj-1', 'dev-api', 1, 'user-1');

    expect(appendEvent).toHaveBeenCalledWith(
      'proj-1',
      'sess-1',
      expect.objectContaining({
        type: 'instruction.rolled_back',
        actor: { kind: 'user', id: 'user-1' },
      }),
    );
  });

  it('versão inexistente: 404', async () => {
    const { useCase } = buildHarness({ target: null });

    await expect(
      useCase.execute('proj-1', 'dev-api', 99, 'user-1'),
    ).rejects.toThrow();
  });

  it('rollback pra versão que já é a vigente: 400, sem evento', async () => {
    const { useCase, appendEvent } = buildHarness({ changed: false });

    await expect(
      useCase.execute('proj-1', 'dev-api', 1, 'user-1'),
    ).rejects.toThrow(/já é o conteúdo vigente/);
    expect(appendEvent).not.toHaveBeenCalled();
  });

  it('projeto sem nenhuma sessão: o rollback acontece mesmo assim', async () => {
    const { useCase, apply, appendEvent } = buildHarness({ hasSession: false });

    const result = await useCase.execute('proj-1', 'dev-api', 1, 'user-1');

    expect(apply).toHaveBeenCalled();
    expect(result.toVersion).toBe(5);
    expect(appendEvent).not.toHaveBeenCalled();
  });
});
