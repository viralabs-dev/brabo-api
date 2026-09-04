import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConvertProjectExecutionModeUseCase } from '../../../../src/application/use-cases/iam/convert-project-execution-mode.use-case';
import type { RegistrarTransicaoDeContainerUseCase } from '../../../../src/application/use-cases/containers/registrar-transicao-de-container.use-case';
import type { UnitOfWork } from '../../../../src/application/ports/unit-of-work.port';
import type {
  ProjectInput,
  ProjectRepository,
} from '../../../../src/application/ports/project-repository.port';
import type { DevAgentActivityPort } from '../../../../src/application/ports/dev-agent-activity.port';
import type { PermissionsFileStore } from '../../../../src/application/ports/permissions-file-store.port';
import type { ContainerRepository } from '../../../../src/application/ports/container-repository.port';
import type {
  ContainerLifecycleStatus,
  ProjectContainerLifecycle,
} from '../../../../src/domain/containers/container-lifecycle';
import { RECURSOS_PADRAO } from '../../../../src/domain/containers/project-container';
import { EMPTY_PERMISSIONS_FILE } from '../../../../src/domain/actions/permissions-file';
import type {
  Project,
  ProjectWorkspaceLocation,
} from '../../../../src/domain/iam/project.entity';

const PROJETO = 'proj-1';

const unitOfWork = {
  runInTransaction: (work: () => Promise<unknown>) => work(),
} as unknown as UnitOfWork;

function projeto(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJETO,
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
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

/** Repositório de projeto falso, com um "banco" em memória de UMA linha. */
function projectRepo(inicial: Project) {
  let atual = inicial;
  const chamadasUpdate: Partial<ProjectInput>[] = [];
  const repo: ProjectRepository = {
    findById: () => Promise.resolve(atual),
    update: (_id: string, input: Partial<ProjectInput>) => {
      chamadasUpdate.push(input);
      atual = { ...atual, ...input, updatedAt: new Date() };
      return Promise.resolve(atual);
    },
  } as unknown as ProjectRepository;
  return { repo, chamadasUpdate, atual: () => atual };
}

function devAgents(ativo: boolean): DevAgentActivityPort {
  return {
    hasActiveAgents: () => Promise.resolve(ativo),
  };
}

function permissionsStore() {
  const movimentos: {
    from: ProjectWorkspaceLocation;
    to: ProjectWorkspaceLocation;
  }[] = [];
  const store: PermissionsFileStore = {
    read: () => Promise.resolve(EMPTY_PERMISSIONS_FILE),
    write: () => Promise.resolve(),
    addPattern: () => Promise.resolve(),
    move: (from, to) => {
      movimentos.push({ from, to });
      return Promise.resolve();
    },
  };
  return { store, movimentos };
}

function containerLinha(
  overrides: Partial<ProjectContainerLifecycle> = {},
): ProjectContainerLifecycle {
  return {
    id: 'lifecycle-1',
    projectId: PROJETO,
    status: 'provisioning',
    imageVersion: 1,
    containerId: null,
    resources: RECURSOS_PADRAO,
    failureReason: null,
    createdAt: new Date('2026-08-14T00:00:00Z'),
    statusChangedAt: new Date('2026-08-14T00:00:00Z'),
    ...overrides,
  };
}

function containerRepo(
  linha: ProjectContainerLifecycle | null,
): ContainerRepository {
  return {
    findByProjectForUpdate: () => Promise.resolve(linha),
  } as unknown as ContainerRepository;
}

/**
 * `RegistrarTransicaoDeContainerUseCase` já tem suite própria
 * (`ciclo-de-vida-do-container.use-case.spec.ts`) — aqui ele é FAKE, só
 * registrando as transições PEDIDAS, porque o que este arquivo prova é a
 * ORQUESTRAÇÃO (que sequência de transições a conversão dispara), não a
 * máquina de estados em si.
 */
function registrarTransicaoFake() {
  const chamadas: ContainerLifecycleStatus[] = [];
  const fake = {
    execute: (_projectId: string, to: ContainerLifecycleStatus) => {
      chamadas.push(to);
      return Promise.resolve(containerLinha({ status: to }));
    },
  };
  return {
    fake: fake as unknown as RegistrarTransicaoDeContainerUseCase,
    chamadas,
  };
}

/**
 * Uma BASE de instalação (ADR 0141) mais uma pasta de projeto DENTRO dela.
 *
 * Desde a RN-501 a conversão para `mounted` exige as duas coisas: o caminho
 * dentro da base (léxico, na validação) e a pasta materializada (mkdir, antes
 * de mover o `permissions.json`). Aqui a pasta é devolvida SEM ser criada —
 * quem a cria é o caso de uso, e é isso que os testes provam.
 */
function baseComProjeto(nome = 'loja'): {
  base: string;
  dir: string;
  limpar: () => void;
} {
  const base = mkdtempSync(join(tmpdir(), 'brabo-convert-execution-mode-'));
  process.env.BRABO_PROJECTS_BASE = base;
  return {
    base,
    dir: join(base, nome),
    limpar: () => rmSync(base, { recursive: true, force: true }),
  };
}

function useCase(deps: {
  projects: ProjectRepository;
  permissions?: PermissionsFileStore;
  devAgentsAtivo?: boolean;
  containers?: ContainerRepository;
  registrarTransicao?: RegistrarTransicaoDeContainerUseCase;
}) {
  return new ConvertProjectExecutionModeUseCase(
    unitOfWork,
    deps.projects,
    deps.permissions ?? permissionsStore().store,
    devAgents(deps.devAgentsAtivo ?? false),
    deps.containers ?? containerRepo(null),
    deps.registrarTransicao ?? registrarTransicaoFake().fake,
  );
}

const pastasParaLimpar: (() => void)[] = [];
const baseOriginal = process.env.BRABO_PROJECTS_BASE;
afterEach(() => {
  if (baseOriginal === undefined) delete process.env.BRABO_PROJECTS_BASE;
  else process.env.BRABO_PROJECTS_BASE = baseOriginal;
  for (const limpar of pastasParaLimpar.splice(0)) limpar();
});

describe('ConvertProjectExecutionModeUseCase', () => {
  it('container -> mounted: CRIA a pasta, relocaliza permissions.json e grava o novo par', async () => {
    const { repo, atual } = projectRepo(projeto());
    const { store, movimentos } = permissionsStore();
    const { dir, limpar } = baseComProjeto();
    pastasParaLimpar.push(limpar);

    // A pasta ainda não existe: a conversão é o único lugar onde
    // mkdir-na-decisão é o certo (RN-501) — ela não tem passo de container
    // onde pendurar o trabalho, e o `permissions.json` vai para dentro dela.
    expect(existsSync(dir)).toBe(false);

    const uc = useCase({ projects: repo, permissions: store });
    const resultado = await uc.execute(PROJETO, {
      executionMode: 'mounted',
      workspacePath: dir,
    });

    expect(existsSync(dir)).toBe(true);
    expect(resultado.executionMode).toBe('mounted');
    expect(resultado.workspacePath).toBe(dir);
    expect(resultado.workspaceVerifiedAt).toBeNull();
    expect(atual().executionMode).toBe('mounted');
    expect(movimentos).toHaveLength(1);
    expect(movimentos[0].from.executionMode).toBe('container');
    expect(movimentos[0].to.executionMode).toBe('mounted');
  });

  it('container -> runner: valida só o léxico (sem tocar disco) e zera workspaceVerifiedAt', async () => {
    const { repo, atual } = projectRepo(projeto());
    const uc = useCase({ projects: repo });

    const resultado = await uc.execute(PROJETO, {
      executionMode: 'runner',
      workspacePath: '/home/alguem/projeto-x',
    });

    expect(resultado.executionMode).toBe('runner');
    expect(resultado.workspacePath).toBe('/home/alguem/projeto-x');
    expect(atual().workspaceVerifiedAt).toBeNull();
  });

  it('container -> runner com container `running`: passa por `stopped` antes de `removed`', async () => {
    const { repo } = projectRepo(projeto());
    const { fake, chamadas } = registrarTransicaoFake();
    const uc = useCase({
      projects: repo,
      containers: containerRepo(containerLinha({ status: 'running' })),
      registrarTransicao: fake,
    });

    await uc.execute(PROJETO, {
      executionMode: 'runner',
      workspacePath: '/home/alguem/projeto-y',
    });

    expect(chamadas).toEqual(['stopped', 'removed']);
  });

  it('container -> mounted com container `provisioning`: vai direto para `removed`', async () => {
    const { repo } = projectRepo(projeto());
    const { fake, chamadas } = registrarTransicaoFake();
    const { dir, limpar } = baseComProjeto();
    pastasParaLimpar.push(limpar);
    const uc = useCase({
      projects: repo,
      containers: containerRepo(containerLinha({ status: 'provisioning' })),
      registrarTransicao: fake,
    });

    await uc.execute(PROJETO, { executionMode: 'mounted', workspacePath: dir });

    expect(chamadas).toEqual(['removed']);
  });

  it('container -> mounted sem linha de container: não chama nenhuma transição', async () => {
    const { repo } = projectRepo(projeto());
    const { fake, chamadas } = registrarTransicaoFake();
    const { dir, limpar } = baseComProjeto();
    pastasParaLimpar.push(limpar);
    const uc = useCase({
      projects: repo,
      containers: containerRepo(null),
      registrarTransicao: fake,
    });

    await uc.execute(PROJETO, { executionMode: 'mounted', workspacePath: dir });

    expect(chamadas).toEqual([]);
  });

  it('mounted -> runner: nenhuma transição de container é disparada (não havia container em `mounted`)', async () => {
    const { dir: dirAntiga, limpar: limparAntiga } = baseComProjeto('antiga');
    pastasParaLimpar.push(limparAntiga);
    const { repo, atual } = projectRepo(
      projeto({ executionMode: 'mounted', workspacePath: dirAntiga }),
    );
    const { fake, chamadas } = registrarTransicaoFake();
    const uc = useCase({ projects: repo, registrarTransicao: fake });

    const resultado = await uc.execute(PROJETO, {
      executionMode: 'runner',
      workspacePath: '/home/alguem/projeto-z',
    });

    expect(resultado.executionMode).toBe('runner');
    expect(chamadas).toEqual([]);
    expect(atual().workspacePath).toBe('/home/alguem/projeto-z');
  });

  it('runner -> mounted: materializa a pasta na entrada (RN-501)', async () => {
    const { repo } = projectRepo(
      projeto({
        executionMode: 'runner',
        workspacePath: '/home/alguem/antiga',
      }),
    );
    const { dir, limpar } = baseComProjeto();
    pastasParaLimpar.push(limpar);
    const uc = useCase({ projects: repo });

    const resultado = await uc.execute(PROJETO, {
      executionMode: 'mounted',
      workspacePath: dir,
    });

    expect(resultado.executionMode).toBe('mounted');
    expect(resultado.workspacePath).toBe(dir);
  });

  it('runner -> container: workspacePath volta a `null`, sem provisionar container automaticamente', async () => {
    const { repo, atual } = projectRepo(
      projeto({
        executionMode: 'runner',
        workspacePath: '/home/alguem/antiga',
        workspaceVerifiedAt: new Date('2026-08-01T00:00:00Z'),
      }),
    );
    const { fake, chamadas } = registrarTransicaoFake();
    const uc = useCase({ projects: repo, registrarTransicao: fake });

    const resultado = await uc.execute(PROJETO, { executionMode: 'container' });

    expect(resultado.executionMode).toBe('container');
    expect(resultado.workspacePath).toBeNull();
    expect(atual().workspaceVerifiedAt).toBeNull();
    // Entrar em `container` nunca aciona o ciclo de vida — só SAIR dele.
    expect(chamadas).toEqual([]);
  });

  it('mesmo (modo, caminho) de hoje: no-op — nenhuma escrita, nenhuma checagem de dev agent', async () => {
    const { repo, chamadasUpdate } = projectRepo(projeto());
    let checou = false;
    const uc = new ConvertProjectExecutionModeUseCase(
      unitOfWork,
      repo,
      permissionsStore().store,
      {
        hasActiveAgents: () => {
          checou = true;
          return Promise.resolve(false);
        },
      },
      containerRepo(null),
      registrarTransicaoFake().fake,
    );

    const resultado = await uc.execute(PROJETO, { executionMode: 'container' });

    expect(resultado.executionMode).toBe('container');
    expect(chamadasUpdate).toHaveLength(0);
    expect(checou).toBe(false);
  });

  it('dev agent ativo recusa a conversão com 409, sem gravar nada', async () => {
    const { repo, chamadasUpdate } = projectRepo(projeto());
    const { store, movimentos } = permissionsStore();
    const { dir, limpar } = baseComProjeto();
    pastasParaLimpar.push(limpar);
    const uc = useCase({
      projects: repo,
      permissions: store,
      devAgentsAtivo: true,
    });

    await expect(
      uc.execute(PROJETO, { executionMode: 'mounted', workspacePath: dir }),
    ).rejects.toThrow(ConflictException);

    expect(chamadasUpdate).toHaveLength(0);
    expect(movimentos).toHaveLength(0);
  });

  it('caminho novo FORA da base vira 400, sem gravar nada e sem criar pasta (RN-501)', async () => {
    const { repo, chamadasUpdate } = projectRepo(projeto());
    const { base, limpar } = baseComProjeto();
    pastasParaLimpar.push(limpar);
    const uc = useCase({ projects: repo });
    const fora = '/tmp/pasta-fora-da-base-de-jeito-nenhum-xyz';

    await expect(
      uc.execute(PROJETO, { executionMode: 'mounted', workspacePath: fora }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      uc.execute(PROJETO, { executionMode: 'mounted', workspacePath: fora }),
    ).rejects.toThrow(new RegExp(`precisa ficar dentro de ${base}`));

    expect(chamadasUpdate).toHaveLength(0);
    expect(existsSync(fora)).toBe(false);
  });

  it('sem base configurada, converter para `mounted` diz que o MODO não está disponível', async () => {
    const { repo, chamadasUpdate } = projectRepo(projeto());
    delete process.env.BRABO_PROJECTS_BASE;
    const uc = useCase({ projects: repo });

    await expect(
      uc.execute(PROJETO, {
        executionMode: 'mounted',
        workspacePath: '/home/voce/brabo/loja',
      }),
    ).rejects.toThrow(/não está disponível nesta instalação/);

    expect(chamadasUpdate).toHaveLength(0);
  });
});
