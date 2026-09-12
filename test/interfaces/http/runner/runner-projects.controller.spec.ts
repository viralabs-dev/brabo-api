import { describe, it, expect, vi } from 'vitest';
import { RunnerProjectsController } from '../../../../src/interfaces/http/runner/runner-projects.controller';
import type { ListRunnerProjectsUseCase } from '../../../../src/application/use-cases/runner/list-runner-projects.use-case';
import type { User } from '../../../../src/domain/iam/user.entity';

/**
 * `GET /runner/projects` (RN-543) na borda HTTP. O controller é fino de
 * propósito — o que ele deve provar é a serialização do `Date`, que é a única
 * decisão que mora aqui: `workspaceVerifiedAt` nulo é o estado NORMAL (pasta
 * nunca confirmada) e não pode virar string vazia nem sumir do corpo.
 */
const USUARIO = { id: 'user-1' } as User;

function montar(
  projetos: Awaited<ReturnType<ListRunnerProjectsUseCase['execute']>>,
) {
  const execute = vi.fn(() => Promise.resolve(projetos));
  return {
    controller: new RunnerProjectsController({
      execute,
    } as unknown as ListRunnerProjectsUseCase),
    execute,
  };
}

describe('RunnerProjectsController', () => {
  it('caminho feliz: serializa a data de verificação em ISO 8601', async () => {
    const { controller, execute } = montar([
      {
        projectId: 'proj-a',
        name: 'Alfa',
        workspaceDirName: 'alfa-01',
        workspaceVerifiedAt: new Date('2026-09-01T10:00:00.000Z'),
      },
    ]);

    await expect(controller.listRunnerProjects(USUARIO)).resolves.toEqual([
      {
        projectId: 'proj-a',
        name: 'Alfa',
        workspaceDirName: 'alfa-01',
        workspaceVerifiedAt: '2026-09-01T10:00:00.000Z',
      },
    ]);
    // O usuário vem do `request.user` que `PatAuthGuard` estabeleceu, nunca
    // de um parâmetro da requisição.
    expect(execute).toHaveBeenCalledWith('user-1');
  });

  it('pasta nunca confirmada: `null` EXPLÍCITO no corpo, nunca campo ausente', async () => {
    const { controller } = montar([
      {
        projectId: 'proj-b',
        name: 'Beta',
        workspaceDirName: 'beta-02',
        workspaceVerifiedAt: null,
      },
    ]);

    const [linha] = await controller.listRunnerProjects(USUARIO);

    expect(linha.workspaceVerifiedAt).toBeNull();
    expect('workspaceVerifiedAt' in linha).toBe(true);
  });

  it('nenhum projeto atendido: lista vazia, nunca erro', async () => {
    const { controller } = montar([]);

    await expect(controller.listRunnerProjects(USUARIO)).resolves.toEqual([]);
  });
});
