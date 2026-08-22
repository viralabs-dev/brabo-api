import { describe, it, expect, vi } from 'vitest';
import { RequestRunnerTicketUseCase } from '../../../../src/application/use-cases/runner/request-runner-ticket.use-case';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { Project } from '../../../../src/domain/iam/project.entity';

const now = new Date();

function buildProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    workspaceId: 'ws-1',
    name: 'Projeto',
    slug: 'projeto',
    workspaceDirName: 'projeto-abcdefgh',
    executionMode: 'container',
    workspacePath: null,
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

  const projects = {
    findById: vi.fn(() => Promise.resolve(project)),
  } as unknown as ProjectRepository;

  const requestRunnerTicket = vi.fn(() =>
    Promise.resolve({
      ticket: 'ticket-bruto',
      expiresAt: new Date(Date.now() + 30_000),
    }),
  );
  const engine = { requestRunnerTicket } as unknown as ApiToEngineClient;

  return {
    useCase: new RequestRunnerTicketUseCase(projects, engine),
    projects,
    requestRunnerTicket,
  };
}

describe('RequestRunnerTicketUseCase', () => {
  it('kind "runner": recusa com 400 quando o projeto NÃO está em modo "runner" (ADR 0104)', async () => {
    const { useCase, requestRunnerTicket } = buildHarness({
      project: buildProject({ executionMode: 'container' }),
    });

    await expect(useCase.execute('proj-1', 'user-1', 'runner')).rejects.toThrow(
      /modo "runner"/i,
    );

    expect(requestRunnerTicket).not.toHaveBeenCalled();
  });

  it('kind "runner": também recusa em modo "mounted" — bind-mount já resolve, sem papel pro runner', async () => {
    const { useCase, requestRunnerTicket } = buildHarness({
      project: buildProject({
        executionMode: 'mounted',
        workspacePath: '/pasta/do/usuario',
      }),
    });

    await expect(useCase.execute('proj-1', 'user-1', 'runner')).rejects.toThrow(
      /modo "runner"/i,
    );

    expect(requestRunnerTicket).not.toHaveBeenCalled();
  });

  it('kind "runner": caminho feliz quando o projeto ESTÁ em modo "runner"', async () => {
    const { useCase, requestRunnerTicket } = buildHarness({
      project: buildProject({
        executionMode: 'runner',
        workspacePath: '/pasta/do/usuario',
      }),
    });

    const emitido = await useCase.execute('proj-1', 'user-1', 'runner');

    expect(emitido.ticket).toBe('ticket-bruto');
    expect(emitido.engineWsUrl).toMatch(/^wss?:\/\/.*\/runner$/);
    expect(requestRunnerTicket).toHaveBeenCalledWith(
      'proj-1',
      'user-1',
      'runner',
    );
  });

  it('kind "terminal": funciona para QUALQUER modo de projeto, inclusive container', async () => {
    const { useCase, requestRunnerTicket } = buildHarness({
      project: buildProject({ executionMode: 'container' }),
    });

    const emitido = await useCase.execute('proj-1', 'user-1', 'terminal');

    expect(emitido.ticket).toBe('ticket-bruto');
    expect(requestRunnerTicket).toHaveBeenCalledWith(
      'proj-1',
      'user-1',
      'terminal',
    );
  });

  it('kind "terminal": também funciona em modo runner', async () => {
    const { useCase, requestRunnerTicket } = buildHarness({
      project: buildProject({
        executionMode: 'runner',
        workspacePath: '/pasta',
      }),
    });

    await useCase.execute('proj-1', 'user-1', 'terminal');

    expect(requestRunnerTicket).toHaveBeenCalledWith(
      'proj-1',
      'user-1',
      'terminal',
    );
  });

  it('projeto inexistente: 404, para os dois kinds', async () => {
    const { useCase } = buildHarness({ project: null });

    await expect(
      useCase.execute('proj-1', 'user-1', 'terminal'),
    ).rejects.toThrow(/Projeto não encontrado/i);
    await expect(useCase.execute('proj-1', 'user-1', 'runner')).rejects.toThrow(
      /Projeto não encontrado/i,
    );
  });
});
