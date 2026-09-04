import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ObterCicloDeVidaDoContainerUseCase } from '../../../../src/application/use-cases/containers/obter-ciclo-de-vida-do-container.use-case';
import { RegistrarTransicaoDeContainerUseCase } from '../../../../src/application/use-cases/containers/registrar-transicao-de-container.use-case';
import type { ObterContainerDoProjetoUseCase } from '../../../../src/application/use-cases/containers/obter-container-do-projeto.use-case';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import type { UnitOfWork } from '../../../../src/application/ports/unit-of-work.port';
import type { OutboxRepository } from '../../../../src/application/ports/outbox-repository.port';
import type { NewOutboxEvent } from '../../../../src/domain/shared/outbox-event.entity';
import {
  ContainerRepository,
  type CreateContainerLifecycleInput,
  type UpdateContainerLifecycleInput,
} from '../../../../src/application/ports/container-repository.port';
import type {
  ContainerLifecycleStatus,
  ProjectContainerLifecycle,
} from '../../../../src/domain/containers/container-lifecycle';
import { RECURSOS_PADRAO } from '../../../../src/domain/containers/project-container';
import type { Project } from '../../../../src/domain/iam/project.entity';

const PROJETO = 'proj-1';

const unitOfWork = {
  runInTransaction: (work: () => Promise<unknown>) => work(),
} as unknown as UnitOfWork;

/**
 * O que a transição publicou (RN-501, ADR 0142) — limpo a cada teste pelo
 * `beforeEach` do describe.
 */
const publicados: NewOutboxEvent[] = [];

const outbox = {
  append: (evento: NewOutboxEvent) => {
    publicados.push(evento);
    return Promise.resolve();
  },
  listUnprocessed: () => Promise.resolve([]),
  markProcessed: () => Promise.resolve(),
} as unknown as OutboxRepository;

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

function linha(
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

/** Repositório de projetos falso — só `findById` importa aqui. */
function projectRepo(p: Project | null): ProjectRepository {
  return { findById: () => Promise.resolve(p) } as unknown as ProjectRepository;
}

/** Repositório de container falso, com um "banco" em memória. */
function containerRepo(inicial: ProjectContainerLifecycle | null = null) {
  let atual = inicial;
  const chamadas: string[] = [];

  const repo: ContainerRepository = {
    findByProject: (projectId: string) => {
      chamadas.push('findByProject');
      return Promise.resolve(
        atual && atual.projectId === projectId ? atual : null,
      );
    },
    findByProjectForUpdate: (projectId: string) => {
      chamadas.push('findByProjectForUpdate');
      return Promise.resolve(
        atual && atual.projectId === projectId ? atual : null,
      );
    },
    create: (input: CreateContainerLifecycleInput) => {
      chamadas.push('create');
      atual = linha({
        projectId: input.projectId,
        imageVersion: input.imageVersion,
        resources: input.resources,
        status: 'provisioning',
      });
      return Promise.resolve(atual);
    },
    updateStatus: (
      id: string,
      status: ContainerLifecycleStatus,
      patch: UpdateContainerLifecycleInput = {},
    ) => {
      chamadas.push('updateStatus');
      if (!atual || atual.id !== id) throw new Error('linha não existe');
      atual = {
        ...atual,
        status,
        statusChangedAt: new Date('2026-08-14T01:00:00Z'),
        ...(patch.containerId !== undefined
          ? { containerId: patch.containerId }
          : {}),
        ...(patch.failureReason !== undefined
          ? { failureReason: patch.failureReason }
          : {}),
      };
      return Promise.resolve(atual);
    },
  };

  return { repo, chamadas, atual: () => atual };
}

function obterImagemDecidida(version = 1): ObterContainerDoProjetoUseCase {
  return {
    execute: () =>
      Promise.resolve({
        status: 'decidido' as const,
        decisao: {
          image: 'node:22-bookworm-slim',
          rationale: 'stack Node',
          network: 'none' as const,
          resources: RECURSOS_PADRAO,
        },
        version,
        eventId: 'evt-1',
        decidedAt: '2026-08-01T00:00:00Z',
      }),
  } as unknown as ObterContainerDoProjetoUseCase;
}

function obterImagemSemDecisao(): ObterContainerDoProjetoUseCase {
  return {
    execute: () =>
      Promise.resolve({
        status: 'sem_decisao' as const,
        decisao: null,
        version: 0,
        eventId: null,
        decidedAt: null,
      }),
  } as unknown as ObterContainerDoProjetoUseCase;
}

describe('ObterCicloDeVidaDoContainerUseCase', () => {
  it('devolve null quando o projeto nunca foi provisionado', async () => {
    const { repo } = containerRepo(null);
    const useCase = new ObterCicloDeVidaDoContainerUseCase(repo);

    expect(await useCase.execute(PROJETO)).toBeNull();
  });

  it('devolve a linha vigente quando existe', async () => {
    const { repo } = containerRepo(linha({ status: 'running' }));
    const useCase = new ObterCicloDeVidaDoContainerUseCase(repo);

    const estado = await useCase.execute(PROJETO);
    expect(estado?.status).toBe('running');
  });
});

describe('RegistrarTransicaoDeContainerUseCase', () => {
  beforeEach(() => {
    publicados.length = 0;
  });

  it('a primeira transição (provisioning) cria a linha, com a versão e os recursos da decisão vigente', async () => {
    const { repo, atual } = containerRepo(null);
    const useCase = new RegistrarTransicaoDeContainerUseCase(
      unitOfWork,
      projectRepo(projeto()),
      repo,
      obterImagemDecidida(3),
      outbox,
    );

    const criada = await useCase.execute(PROJETO, 'provisioning');

    expect(criada.status).toBe('provisioning');
    expect(criada.imageVersion).toBe(3);
    expect(criada.resources).toEqual(RECURSOS_PADRAO);
    expect(atual()?.status).toBe('provisioning');
  });

  it('caminho feliz: provisioning -> running numa linha existente', async () => {
    const { repo } = containerRepo(linha({ status: 'provisioning' }));
    const useCase = new RegistrarTransicaoDeContainerUseCase(
      unitOfWork,
      projectRepo(projeto()),
      repo,
      obterImagemDecidida(),
      outbox,
    );

    const atualizada = await useCase.execute(PROJETO, 'running', {
      containerId: 'abc123',
    });

    expect(atualizada.status).toBe('running');
    expect(atualizada.containerId).toBe('abc123');
  });

  // RN-501/ADR 0142 — a leitura que o engine faz de `project_containers` não
  // avisa ninguém; quem solta os dev agents parados em `:idle` é este evento.
  it('chegar em `running` publica `container.running` no agregado `container`, com o id do PROJETO', async () => {
    const { repo } = containerRepo(linha({ status: 'provisioning' }));
    const useCase = new RegistrarTransicaoDeContainerUseCase(
      unitOfWork,
      projectRepo(projeto()),
      repo,
      obterImagemDecidida(),
      outbox,
    );

    await useCase.execute(PROJETO, 'running', { containerId: 'abc123' });

    expect(publicados).toEqual([
      {
        aggregateType: 'container',
        aggregateId: PROJETO,
        eventType: 'container.running',
        payload: { projectId: PROJETO },
      },
    ]);
  });

  it.each(['provisioning', 'stopped'] as const)(
    'transição para `%s` NÃO publica nada — só `running` solta dev agent',
    async (destino) => {
      const inicial = destino === 'provisioning' ? 'failed' : 'running';
      const { repo } = containerRepo(linha({ status: inicial }));
      const useCase = new RegistrarTransicaoDeContainerUseCase(
        unitOfWork,
        projectRepo(projeto()),
        repo,
        obterImagemDecidida(),
        outbox,
      );

      await useCase.execute(PROJETO, destino);

      expect(publicados).toEqual([]);
    },
  );

  it('a PRIMEIRA transição (criação da linha) não publica — ela nasce sempre em `provisioning`', async () => {
    const { repo } = containerRepo(null);
    const useCase = new RegistrarTransicaoDeContainerUseCase(
      unitOfWork,
      projectRepo(projeto()),
      repo,
      obterImagemDecidida(2),
      outbox,
    );

    await useCase.execute(PROJETO, 'provisioning');

    expect(publicados).toEqual([]);
  });

  it.each(['mounted', 'runner'] as const)(
    'projeto em modo `%s` também registra ciclo de vida de container agora (RN-494, revisa ADR 0072/0104)',
    async (executionMode) => {
      const { repo, atual } = containerRepo(null);
      const useCase = new RegistrarTransicaoDeContainerUseCase(
        unitOfWork,
        projectRepo(projeto({ executionMode, workspacePath: '/repos/x' })),
        repo,
        obterImagemDecidida(2),
        outbox,
      );

      const criada = await useCase.execute(PROJETO, 'provisioning');

      expect(criada.status).toBe('provisioning');
      expect(criada.imageVersion).toBe(2);
      expect(atual()?.status).toBe('provisioning');
    },
  );

  it('sem decisão de imagem do Arquiteto, não há o que provisionar (RN-105)', async () => {
    const { repo } = containerRepo(null);
    const useCase = new RegistrarTransicaoDeContainerUseCase(
      unitOfWork,
      projectRepo(projeto()),
      repo,
      obterImagemSemDecisao(),
      outbox,
    );

    await expect(useCase.execute(PROJETO, 'provisioning')).rejects.toThrow(
      ConflictException,
    );
  });

  it('sem linha existente, só `provisioning` é aceito como primeira transição', async () => {
    const { repo } = containerRepo(null);
    const useCase = new RegistrarTransicaoDeContainerUseCase(
      unitOfWork,
      projectRepo(projeto()),
      repo,
      obterImagemDecidida(),
      outbox,
    );

    await expect(useCase.execute(PROJETO, 'running')).rejects.toThrow(
      ConflictException,
    );
  });

  it('transição inválida na linha existente vira 409, sem gravar nada', async () => {
    const { repo, atual } = containerRepo(linha({ status: 'running' }));
    const useCase = new RegistrarTransicaoDeContainerUseCase(
      unitOfWork,
      projectRepo(projeto()),
      repo,
      obterImagemDecidida(),
      outbox,
    );

    await expect(useCase.execute(PROJETO, 'provisioning')).rejects.toThrow(
      ConflictException,
    );
    // O estado não mudou: a rejeição aconteceu ANTES de qualquer escrita.
    expect(atual()?.status).toBe('running');
  });

  it('projeto inexistente vira 404', async () => {
    const { repo } = containerRepo(null);
    const useCase = new RegistrarTransicaoDeContainerUseCase(
      unitOfWork,
      projectRepo(null),
      repo,
      obterImagemDecidida(),
      outbox,
    );

    await expect(useCase.execute(PROJETO, 'provisioning')).rejects.toThrow(
      NotFoundException,
    );
  });
});
