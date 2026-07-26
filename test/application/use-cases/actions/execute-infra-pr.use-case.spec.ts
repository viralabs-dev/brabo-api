import { describe, it, expect, vi } from 'vitest';
import {
  ExecuteInfraPrUseCase,
  normalizeInfraPath,
} from '../../../../src/application/use-cases/actions/execute-infra-pr.use-case';
import { GitBranchAlreadyExistsError } from '../../../../src/domain/git/git-errors';
import type { ProposedAction } from '../../../../src/domain/actions/proposed-action.entity';

function makeAction(): ProposedAction {
  return {
    id: 'pa-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    seq: 1,
    actionType: 'open_infra_pr',
    payload: {
      title: 'infra setup',
      files: [{ path: 'api/Dockerfile', content: 'FROM node:24-alpine' }],
    },
    status: 'auto_approved',
    resolvedPolicy: 'auto_approve',
    actor: { kind: 'agent', id: 'infra' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: null,
  } as unknown as ProposedAction;
}

function build(provider: {
  createBranch: ReturnType<typeof vi.fn>;
  commitFiles: ReturnType<typeof vi.fn>;
  openPullRequest: ReturnType<typeof vi.fn>;
}) {
  const gravados: { status: string; executionResult: unknown }[] = [];

  const useCase = new ExecuteInfraPrUseCase(
    { runInTransaction: async (fn: () => unknown) => fn() } as never,
    {
      updateExecutionResult: async (
        _id: string,
        input: { status: string; executionResult: unknown },
      ) => {
        gravados.push(input);
        return { ...makeAction(), ...input };
      },
      listByProjectAndType: async () => [],
    } as never,
    { execute: async () => undefined } as never,
    { append: async () => undefined } as never,
    { get: () => provider } as never,
    {
      findByProjectId: async () => ({
        provider: 'local',
        externalId: 'repo-1',
        defaultBranch: 'main',
      }),
    } as never,
    { findSecretByUserAndProvider: async () => null } as never,
    { decrypt: () => '' } as never,
    { findBySessionId: async () => null, create: async () => undefined } as never,
  );

  return { useCase, gravados };
}

describe('normalizeInfraPath', () => {
  it('barra à esquerda é normalizada — foi o que derrubou a primeira PR do aceite', () => {
    // O InfraAgent produziu `/api/Dockerfile`; o `git update-index --cacheinfo`
    // do provider local recusa caminho absoluto e a PR morria com um erro
    // opaco de git (ADR 0021).
    expect(normalizeInfraPath('/api/Dockerfile')).toBe('api/Dockerfile');
    expect(normalizeInfraPath('///worker/Dockerfile')).toBe('worker/Dockerfile');
  });

  it('caminho já relativo passa intacto', () => {
    expect(normalizeInfraPath('.github/workflows/ci.yml')).toBe(
      '.github/workflows/ci.yml',
    );
  });

  it('travessia é RECUSADA, não normalizada', () => {
    expect(() => normalizeInfraPath('../../etc/passwd')).toThrow(/travessia/);
    expect(() => normalizeInfraPath('api/../../fora')).toThrow(/travessia/);
  });

  it('path vazio é recusado', () => {
    expect(() => normalizeInfraPath('   ')).toThrow(/vazio/);
  });
});

describe('ExecuteInfraPrUseCase — criação de branch idempotente', () => {
  it('branch já existente não impede a PR de ser aberta', async () => {
    // Regressão da execução do critério de aceite (ADR 0021): a branch é
    // criada ANTES do artefato existir, e o artefato só é gravado no sucesso.
    // Qualquer falha entre os dois travava a sessão PERMANENTEMENTE — toda
    // tentativa seguinte morria em "branch já existe", cinco vezes seguidas.
    const provider = {
      createBranch: vi
        .fn()
        .mockRejectedValue(new GitBranchAlreadyExistsError('repo-1', 'feature/infra-setup')),
      commitFiles: vi.fn().mockResolvedValue(undefined),
      openPullRequest: vi
        .fn()
        .mockResolvedValue({ id: 1, url: 'local://repo/pull/1' }),
    };

    const { useCase, gravados } = build(provider);
    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(provider.commitFiles).toHaveBeenCalled();
    expect(provider.openPullRequest).toHaveBeenCalled();
    expect(gravados.at(-1)?.status).toBe('executed');
  });

  it('outro erro de git continua falhando a ação', async () => {
    const provider = {
      createBranch: vi.fn().mockRejectedValue(new Error('rede fora do ar')),
      commitFiles: vi.fn(),
      openPullRequest: vi.fn(),
    };

    const { useCase, gravados } = build(provider);
    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(provider.commitFiles).not.toHaveBeenCalled();
    expect(gravados.at(-1)?.status).toBe('failed');
  });
});
