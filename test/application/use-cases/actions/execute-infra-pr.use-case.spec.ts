import { describe, it, expect, vi } from 'vitest';
import {
  ExecuteInfraPrUseCase,
  normalizeInfraPath,
} from '../../../../src/application/use-cases/actions/execute-infra-pr.use-case';
import { GitBranchAlreadyExistsError } from '../../../../src/domain/git/git-errors';
import type { ProposedAction } from '../../../../src/domain/actions/proposed-action.entity';

const RUN = {
  command: 'cp .env.example .env && docker compose up --build',
  urls: [
    { label: 'Swagger', url: 'http://localhost:8080/docs', kind: 'api_docs' },
  ],
  envExample: true,
};

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
      run: RUN,
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
  const eventos: { type: string; payload: unknown }[] = [];

  const useCase = new ExecuteInfraPrUseCase(
    { runInTransaction: (fn: () => unknown) => Promise.resolve(fn()) } as never,
    {
      updateExecutionResult: (
        _id: string,
        input: { status: string; executionResult: unknown },
      ) => {
        gravados.push(input);
        return Promise.resolve({ ...makeAction(), ...input });
      },
      listByProjectAndType: () => Promise.resolve([]),
    } as never,
    {
      execute: (
        _p: string,
        _s: string,
        e: { type: string; payload: unknown },
      ) => {
        eventos.push(e);
        return Promise.resolve(undefined);
      },
    } as never,
    { append: () => Promise.resolve(undefined) },
    { get: () => provider } as never,
    {
      findByProjectId: () =>
        Promise.resolve({
          provider: 'local',
          externalId: 'repo-1',
          defaultBranch: 'main',
        }),
    } as never,
    { findSecretByUserAndProvider: () => Promise.resolve(null) } as never,
    { decrypt: () => '' } as never,
    {
      findBySessionId: () => Promise.resolve(null),
      create: () => Promise.resolve(undefined),
    } as never,
    {
      listByTypeForProject: () =>
        Promise.resolve([{ payload: { version: 3 }, seq: 1 }]),
    } as never,
  );

  return { useCase, gravados, eventos };
}

describe('normalizeInfraPath', () => {
  it('barra à esquerda é normalizada — foi o que derrubou a primeira PR do aceite', () => {
    // O InfraAgent produziu `/api/Dockerfile`; o `git update-index --cacheinfo`
    // do provider local recusa caminho absoluto e a PR morria com um erro
    // opaco de git (ADR 0021).
    expect(normalizeInfraPath('/api/Dockerfile')).toBe('api/Dockerfile');
    expect(normalizeInfraPath('///worker/Dockerfile')).toBe(
      'worker/Dockerfile',
    );
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
        .mockRejectedValue(
          new GitBranchAlreadyExistsError('repo-1', 'feature/infra-setup'),
        ),
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

describe('ExecuteInfraPrUseCase — base e autor da PR (RN-729)', () => {
  it('a branch nasce de dev, a PR mira dev e leva infra[bot]', async () => {
    const provider = {
      createBranch: vi.fn().mockResolvedValue(undefined),
      commitFiles: vi.fn().mockResolvedValue(undefined),
      openPullRequest: vi
        .fn()
        .mockResolvedValue({ id: 1, url: 'local://repo/pull/1' }),
    };
    const { useCase, gravados } = build(provider);
    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(provider.createBranch).toHaveBeenCalledWith(
      expect.objectContaining({ fromRef: 'dev' }),
    );
    expect(provider.openPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ targetBranch: 'dev', author: 'infra[bot]' }),
    );
    expect(gravados.at(-1)?.status).toBe('executed');
  });

  it('repositório sem dev falha nomeado, sem cair na default', async () => {
    const provider = {
      createBranch: vi
        .fn()
        .mockRejectedValue(new Error('ref não encontrada: dev')),
      commitFiles: vi.fn(),
      openPullRequest: vi.fn(),
    };
    const { useCase, gravados } = build(provider);
    await useCase.execute('proj-1', 'sess-1', makeAction());

    expect(provider.openPullRequest).not.toHaveBeenCalled();
    expect(gravados.at(-1)?.status).toBe('failed');
  });
});

describe('ExecuteInfraPrUseCase — instruções de execução (RN-852)', () => {
  const okProvider = () => ({
    createBranch: vi.fn().mockResolvedValue(undefined),
    commitFiles: vi.fn().mockResolvedValue(undefined),
    openPullRequest: vi
      .fn()
      .mockResolvedValue({ id: 1, url: 'local://repo/pull/1' }),
  });

  it('PR aberta emite artifact.run_instructions com prUrl e versão seguinte', async () => {
    const { useCase, eventos } = build(okProvider());
    await useCase.execute('proj-1', 'sess-1', makeAction());
    const artefato = eventos.find(
      (e) => e.type === 'artifact.run_instructions',
    );
    expect(artefato?.payload).toEqual({
      ...RUN,
      prUrl: 'local://repo/pull/1',
      version: 4,
    });
  });

  it('`run` inválido na execução falha sem commitar nem emitir', async () => {
    const provider = okProvider();
    const { useCase, gravados, eventos } = build(provider);
    const action = makeAction();
    (action.payload as Record<string, unknown>).run = {
      ...RUN,
      urls: [{ label: 'x', url: 'http://10.0.0.1:80/', kind: 'web' }],
    };
    await useCase.execute('proj-1', 'sess-1', action);
    expect(provider.commitFiles).not.toHaveBeenCalled();
    expect(gravados.at(-1)?.status).toBe('failed');
    expect(eventos.some((e) => e.type === 'artifact.run_instructions')).toBe(
      false,
    );
  });
});
