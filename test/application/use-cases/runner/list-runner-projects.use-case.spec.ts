import { describe, it, expect, vi } from 'vitest';
import { ListRunnerProjectsUseCase } from '../../../../src/application/use-cases/runner/list-runner-projects.use-case';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import type { ResolveEffectiveRoleUseCase } from '../../../../src/application/use-cases/iam/resolve-effective-role.use-case';
import type { Project } from '../../../../src/domain/iam/project.entity';
import type { Role } from '../../../../src/domain/iam/role';

/**
 * `GET /runner/projects` (RN-543, ADR 0154 ponto 3) — como o agente local de
 * MÁQUINA descobre os projetos que atende.
 *
 * O que estes casos protegem não é o formato da lista: é que o mínimo
 * `developer` continua sendo aplicado, projeto a projeto, com a régua ÚNICA
 * do produto (`ResolveEffectiveRoleUseCase.forProject`). A rota não tem
 * `:projectId` e por isso não tem `@RequireRole` — se o filtro daqui
 * afrouxar, nada mais segura.
 */
function projeto(parcial: Partial<Project> & { id: string }): Project {
  return {
    workspaceId: 'ws-1',
    name: parcial.id,
    slug: parcial.id,
    workspaceDirName: `${parcial.id}-dir`,
    executionMode: 'runner',
    workspacePath: '/home/dev/projetos/x',
    workspaceVerifiedAt: null,
    ...parcial,
  } as Project;
}

function montar(opcoes: {
  candidatos: Project[];
  papeis?: Record<string, Role | null>;
}) {
  const listRunnerModeReachableBy = vi.fn(() =>
    Promise.resolve(opcoes.candidatos),
  );
  const forProject = vi.fn((_userId: string, projectId: string) =>
    Promise.resolve(opcoes.papeis?.[projectId] ?? null),
  );
  return {
    useCase: new ListRunnerProjectsUseCase(
      { listRunnerModeReachableBy } as unknown as ProjectRepository,
      { forProject } as unknown as ResolveEffectiveRoleUseCase,
    ),
    listRunnerModeReachableBy,
    forProject,
  };
}

describe('ListRunnerProjectsUseCase', () => {
  it('caminho feliz: devolve os projetos alcançados, com pasta e estado de verificação', async () => {
    const verificadoEm = new Date('2026-09-01T10:00:00.000Z');
    const { useCase, listRunnerModeReachableBy } = montar({
      candidatos: [
        projeto({ id: 'proj-a', name: 'Alfa', workspaceDirName: 'alfa-01' }),
        projeto({
          id: 'proj-b',
          name: 'Beta',
          workspaceDirName: 'beta-02',
          workspaceVerifiedAt: verificadoEm,
        }),
      ],
      papeis: { 'proj-a': 'developer', 'proj-b': 'owner' },
    });

    await expect(useCase.execute('user-1')).resolves.toEqual([
      {
        projectId: 'proj-a',
        name: 'Alfa',
        workspaceDirName: 'alfa-01',
        workspaceVerifiedAt: null,
      },
      {
        projectId: 'proj-b',
        name: 'Beta',
        workspaceDirName: 'beta-02',
        workspaceVerifiedAt: verificadoEm,
      },
    ]);
    expect(listRunnerModeReachableBy).toHaveBeenCalledWith('user-1');
  });

  it('CASO DE FALHA: alcançar o projeto não basta — papel abaixo de developer fica de FORA', async () => {
    // O mesmo mínimo de `runner-ticket`. Listar aqui o que a rota seguinte
    // recusaria seria prometer o que o produto nega.
    const { useCase } = montar({
      candidatos: [projeto({ id: 'proj-a' }), projeto({ id: 'proj-b' })],
      papeis: { 'proj-a': 'viewer', 'proj-b': 'developer' },
    });

    const atendidos = await useCase.execute('user-1');

    expect(atendidos.map((p) => p.projectId)).toEqual(['proj-b']);
  });

  it('papel NENHUM no projeto candidato: fica de fora, sem erro', async () => {
    const { useCase } = montar({
      candidatos: [projeto({ id: 'proj-a' })],
      papeis: {},
    });

    await expect(useCase.execute('user-1')).resolves.toEqual([]);
  });

  it('nenhum candidato: lista vazia, e a régua de papel nem é consultada', async () => {
    const { useCase, forProject } = montar({ candidatos: [] });

    await expect(useCase.execute('user-1')).resolves.toEqual([]);
    expect(forProject).not.toHaveBeenCalled();
  });

  it('o papel sai da régua ÚNICA do produto, nunca de um `??` reescrito em SQL', async () => {
    const { useCase, forProject } = montar({
      candidatos: [projeto({ id: 'proj-a' })],
      papeis: { 'proj-a': 'maintainer' },
    });

    await useCase.execute('user-1');

    expect(forProject).toHaveBeenCalledWith('user-1', 'proj-a');
  });
});
