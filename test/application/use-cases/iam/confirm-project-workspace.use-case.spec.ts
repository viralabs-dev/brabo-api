import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfirmProjectWorkspaceUseCase } from '../../../../src/application/use-cases/iam/confirm-project-workspace.use-case';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import type { UnitOfWork } from '../../../../src/application/ports/unit-of-work.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { Project } from '../../../../src/domain/iam/project.entity';

const now = new Date();

function buildProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    workspaceId: 'ws-1',
    name: 'Projeto',
    slug: 'projeto',
    workspaceDirName: 'projeto-abcdefgh',
    executionMode: 'runner',
    workspacePath: '/home/voce/projetos/loja',
    workspaceVerifiedAt: null,
    createdBy: 'user-1',
    taskBudgetMicros: null,
    maxConsecutiveBlocked: null,
    storyPromotion: 'manual',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildHarness(opts: { project?: Project | null }) {
  const project = opts.project === undefined ? buildProject() : opts.project;

  const update = vi.fn(() => Promise.resolve());
  const projects = {
    findById: vi.fn(() => Promise.resolve(project)),
    update,
  } as unknown as ProjectRepository;

  const unitOfWork = {
    runInTransaction: vi.fn((work: () => Promise<unknown>) => work()),
  } as unknown as UnitOfWork;

  const execute = vi.fn(() => Promise.resolve());
  const appendEvent = { execute } as unknown as AppendSessionEventUseCase;

  return {
    useCase: new ConfirmProjectWorkspaceUseCase(projects, unitOfWork, appendEvent),
    projects,
    update,
    appendEventExecute: execute,
  };
}

/**
 * RN-423 (ADR 0104) — o endpoint interno que o engine chama quando o runner
 * confirma o caminho. As três decisões confirmadas com o usuário: o runner é
 * a fonte da verdade (sobrescreve, sem exigir igualdade); sem sessão ainda, o
 * UPDATE acontece mesmo assim e só o evento é pulado; e a checagem léxica
 * roda incondicionalmente, mesmo vindo do runner.
 */
describe('ConfirmProjectWorkspaceUseCase', () => {
  it('projeto inexistente: 404', async () => {
    const { useCase } = buildHarness({ project: null });

    await expect(
      useCase.execute('proj-1', { path: '/home/voce/loja' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('projeto fora do modo "runner": 400 — só runner tem workspace verificado por essa via', async () => {
    const { useCase, update } = buildHarness({
      project: buildProject({ executionMode: 'mounted' }),
    });

    await expect(
      useCase.execute('proj-1', { path: '/home/voce/loja' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('caminho lexicamente inválido é rejeitado, mesmo vindo do runner — nunca gravado', async () => {
    const { useCase, update } = buildHarness({
      project: buildProject({ workspaceVerifiedAt: null }),
    });

    await expect(
      useCase.execute('proj-1', { path: '/etc/passwd' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('primeira confirmação: grava path + workspaceVerifiedAt e emite o evento', async () => {
    const { useCase, update, appendEventExecute } = buildHarness({
      project: buildProject({
        workspaceVerifiedAt: null,
        workspacePath: '/home/voce/projetos/loja',
      }),
    });

    const resultado = await useCase.execute('proj-1', {
      path: '/home/voce/projetos/loja/',
      sessionId: 'sess-1',
      actorId: 'user-1',
    });

    expect(resultado).toEqual({
      verified: true,
      workspacePath: '/home/voce/projetos/loja',
      changed: true,
    });
    expect(update).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({ workspacePath: '/home/voce/projetos/loja' }),
    );
    expect(appendEventExecute).toHaveBeenCalledWith(
      'proj-1',
      'sess-1',
      expect.objectContaining({ type: 'project.workspace_verified' }),
    );
  });

  it('o runner É a fonte da verdade: um caminho DIFERENTE do que foi digitado na criação sobrescreve, sem exigir igualdade', async () => {
    const { useCase, update } = buildHarness({
      project: buildProject({
        workspaceVerifiedAt: now,
        workspacePath: '/home/voce/projetos/loja-antiga',
      }),
    });

    const resultado = await useCase.execute('proj-1', {
      path: '/home/voce/projetos/loja-nova',
      sessionId: 'sess-1',
    });

    expect(resultado.changed).toBe(true);
    expect(resultado.workspacePath).toBe('/home/voce/projetos/loja-nova');
    expect(update).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({ workspacePath: '/home/voce/projetos/loja-nova' }),
    );
  });

  it('reconexão com o MESMO caminho é idempotente — não regrava', async () => {
    const { useCase, update, appendEventExecute } = buildHarness({
      project: buildProject({
        workspaceVerifiedAt: now,
        workspacePath: '/home/voce/projetos/loja',
      }),
    });

    const resultado = await useCase.execute('proj-1', {
      path: '/home/voce/projetos/loja',
      sessionId: 'sess-1',
    });

    expect(resultado.changed).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(appendEventExecute).not.toHaveBeenCalled();
  });

  it('sem sessão ainda: o UPDATE acontece do mesmo jeito, só o evento é pulado (lacuna aceita)', async () => {
    const { useCase, update, appendEventExecute } = buildHarness({
      project: buildProject({
        workspaceVerifiedAt: null,
        workspacePath: '/home/voce/projetos/loja',
      }),
    });

    const resultado = await useCase.execute('proj-1', {
      path: '/home/voce/projetos/loja',
      sessionId: null,
    });

    expect(resultado.changed).toBe(true);
    expect(update).toHaveBeenCalled();
    expect(appendEventExecute).not.toHaveBeenCalled();
  });

  it('sessão referenciada não existe (mais): o evento falha, mas o UPDATE já aconteceu — engolido', async () => {
    const project = buildProject({
      workspaceVerifiedAt: null,
      workspacePath: '/home/voce/projetos/loja',
    });
    const { projects, update } = buildHarness({ project });
    const unitOfWork = {
      runInTransaction: vi.fn((work: () => Promise<unknown>) => work()),
    } as unknown as UnitOfWork;
    const appendEvent = {
      execute: vi.fn(() => Promise.reject(new NotFoundException('Sessão não encontrada'))),
    } as unknown as AppendSessionEventUseCase;
    const useCase = new ConfirmProjectWorkspaceUseCase(projects, unitOfWork, appendEvent);

    const resultado = await useCase.execute('proj-1', {
      path: '/home/voce/projetos/loja',
      sessionId: 'sess-sumida',
    });

    expect(resultado.changed).toBe(true);
    expect(update).toHaveBeenCalled();
  });
});
