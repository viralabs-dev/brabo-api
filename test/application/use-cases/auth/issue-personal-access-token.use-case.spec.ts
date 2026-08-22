import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { IssuePersonalAccessTokenUseCase } from '../../../../src/application/use-cases/auth/issue-personal-access-token.use-case';
import { TokenFactory } from '../../../../src/application/use-cases/auth/token-factory';
import type { PersonalAccessTokenRepository } from '../../../../src/application/ports/personal-access-token-repository.port';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';

function buildHarness(opts: { project?: unknown } = {}) {
  const project = opts.project === undefined ? { id: 'proj-1' } : opts.project;
  const projects = {
    findById: vi.fn(() => Promise.resolve(project)),
  } as unknown as ProjectRepository;
  const emitir = vi.fn((novo: unknown) =>
    Promise.resolve({
      id: 'pat-1',
      name: (novo as { name: string }).name,
      projectId: (novo as { projectId: string }).projectId,
      createdAt: new Date(),
      expiresAt: (novo as { expiresAt: Date | null }).expiresAt,
      revokedAt: null,
      lastUsedAt: null,
    }),
  );
  const tokens = { emitir } as unknown as PersonalAccessTokenRepository;

  return {
    useCase: new IssuePersonalAccessTokenUseCase(
      tokens,
      new TokenFactory(),
      projects,
    ),
    emitir,
  };
}

describe('IssuePersonalAccessTokenUseCase', () => {
  it('caminho feliz: token bruto começa com brb_ e o hash gravado NÃO é o texto bruto', async () => {
    const { useCase, emitir } = buildHarness();

    const emitido = await useCase.execute({
      userId: 'user-1',
      projectId: 'proj-1',
      name: 'laptop',
    });

    expect(emitido.token).toMatch(/^brb_/);
    expect(emitir).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        projectId: 'proj-1',
        name: 'laptop',
      }),
    );
    const gravado = emitir.mock.calls[0][0] as { tokenHash: string };
    expect(gravado.tokenHash).not.toBe(emitido.token);
  });

  it('sem expiresInDays: expiresAt gravado é null (expiração opcional)', async () => {
    const { useCase, emitir } = buildHarness();

    await useCase.execute({
      userId: 'user-1',
      projectId: 'proj-1',
      name: 'laptop',
    });

    expect(emitir.mock.calls[0][0]).toMatchObject({ expiresAt: null });
  });

  it('com expiresInDays: expiresAt gravado é uma data futura', async () => {
    const { useCase, emitir } = buildHarness();

    await useCase.execute({
      userId: 'user-1',
      projectId: 'proj-1',
      name: 'laptop',
      expiresInDays: 7,
    });

    const { expiresAt } = emitir.mock.calls[0][0] as { expiresAt: Date };
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('projeto inexistente: 404, nunca chega a emitir', async () => {
    const { useCase, emitir } = buildHarness({ project: null });

    await expect(
      useCase.execute({
        userId: 'user-1',
        projectId: 'proj-sumiu',
        name: 'laptop',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(emitir).not.toHaveBeenCalled();
  });
});
