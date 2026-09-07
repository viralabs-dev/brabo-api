import { describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RecordMirrorSyncUseCase } from '../../../../src/application/use-cases/iam/record-mirror-sync.use-case';
import { GetProjectMirrorStateUseCase } from '../../../../src/application/use-cases/iam/get-project-mirror-state.use-case';
import { deriveMirrorSyncStatus } from '../../../../src/domain/iam/mirror-state';
import type {
  MirrorStateRepository,
  RecordMirrorFailureInput,
  RecordMirrorSuccessInput,
} from '../../../../src/application/ports/mirror-state-repository.port';
import type { ProjectMirrorState } from '../../../../src/domain/iam/mirror-state';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import type { Project } from '../../../../src/domain/iam/project.entity';

/**
 * A telemetria do espelho (RN-517, ADR 0147 ponto 7).
 *
 * O que este arquivo prova é o que o ponto 7 pede por escrito: os TRÊS
 * estados da RN-088 são distinguíveis na leitura, e sucesso e erro CONVIVEM —
 * o último erro não apaga a última sincronização boa, que é a informação mais
 * útil que a tela tem enquanto o espelho está quebrado.
 *
 * Nada aqui toca event log, `proposed_action` ou o disco: a rodada já
 * aconteceu na máquina do usuário quando este caminho começa.
 */

const PROJETO = 'proj-1';

function projeto(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJETO,
    workspaceId: 'ws-1',
    name: 'Projeto',
    slug: 'projeto',
    workspaceDirName: 'projeto-abcdefgh',
    executionMode: 'mounted',
    workspacePath: '/home/voce/projetos-brabo/projeto',
    workspaceVerifiedAt: null,
    mirrorPath: '/home/voce/espelhos/projeto',
    createdBy: 'user-1',
    taskBudgetMicros: null,
    maxConsecutiveBlocked: null,
    storyPromotion: 'manual',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Repositório falso com a MESMA disciplina de colunas do Drizzle: a escrita de
 * sucesso não menciona as colunas de erro e a de falha não menciona as de
 * sucesso. Um fake que sobrescrevesse tudo esconderia justamente o invariante
 * que este arquivo existe para provar.
 */
function mirrorRepo(inicial: ProjectMirrorState | null = null) {
  let atual = inicial;

  function base(projectId: string): ProjectMirrorState {
    return (
      atual ?? {
        projectId,
        lastSyncedAt: null,
        filesCopied: null,
        filesSkipped: null,
        filesRefused: null,
        destination: null,
        lastErrorAt: null,
        lastError: null,
        updatedAt: new Date(),
      }
    );
  }

  const repo: MirrorStateRepository = {
    findByProject: () => Promise.resolve(atual),
    recordSuccess: (input: RecordMirrorSuccessInput) => {
      atual = {
        ...base(input.projectId),
        lastSyncedAt: input.syncedAt,
        filesCopied: input.filesCopied,
        filesSkipped: input.filesSkipped,
        filesRefused: input.filesRefused,
        destination: input.destination,
        updatedAt: new Date(),
      };
      return Promise.resolve(atual);
    },
    recordFailure: (input: RecordMirrorFailureInput) => {
      atual = {
        ...base(input.projectId),
        lastErrorAt: input.failedAt,
        lastError: input.error,
        ...(input.destination !== null
          ? { destination: input.destination }
          : {}),
        updatedAt: new Date(),
      };
      return Promise.resolve(atual);
    },
  };

  return { repo, atual: () => atual };
}

function projectRepo(p: Project | null) {
  return {
    findById: () => Promise.resolve(p),
  } as unknown as ProjectRepository;
}

describe('deriveMirrorSyncStatus (RN-517, os três estados da RN-088)', () => {
  const vazio: ProjectMirrorState = {
    projectId: PROJETO,
    lastSyncedAt: null,
    filesCopied: null,
    filesSkipped: null,
    filesRefused: null,
    destination: null,
    lastErrorAt: null,
    lastError: null,
    updatedAt: new Date(),
  };

  it('linha AUSENTE é "never" — nunca olhei', () => {
    expect(deriveMirrorSyncStatus(null)).toBe('never');
  });

  it('sincronizou copiando ZERO ainda é "synced", nunca "never"', () => {
    expect(
      deriveMirrorSyncStatus({
        ...vazio,
        lastSyncedAt: new Date('2026-09-07T10:00:00Z'),
        filesCopied: 0,
      }),
    ).toBe('synced');
  });

  it('erro MAIS RECENTE que o último sucesso é "failed"', () => {
    expect(
      deriveMirrorSyncStatus({
        ...vazio,
        lastSyncedAt: new Date('2026-09-06T10:00:00Z'),
        lastErrorAt: new Date('2026-09-07T10:00:00Z'),
        lastError: 'git falhou',
      }),
    ).toBe('failed');
  });

  it('sucesso MAIS RECENTE que o erro volta a ser "synced" sem apagar nada', () => {
    expect(
      deriveMirrorSyncStatus({
        ...vazio,
        lastSyncedAt: new Date('2026-09-07T11:00:00Z'),
        lastErrorAt: new Date('2026-09-07T10:00:00Z'),
        lastError: 'git falhou',
      }),
    ).toBe('synced');
  });

  it('linha sem carimbo nenhum NÃO vira "synced" por omissão', () => {
    expect(deriveMirrorSyncStatus(vazio)).toBe('never');
  });
});

describe('RecordMirrorSyncUseCase (RN-517)', () => {
  it('grava o desfecho REAL com as três contagens e o destino congelado', async () => {
    const { repo, atual } = mirrorRepo();
    const uc = new RecordMirrorSyncUseCase(projectRepo(projeto()), repo);

    const resultado = await uc.execute(PROJETO, {
      ok: true,
      destination: '/home/voce/espelhos/projeto',
      filesCopied: 412,
      filesSkipped: 3,
      filesRefused: 0,
    });

    expect(resultado).toEqual({ recorded: true, status: 'synced' });
    expect(atual()).toMatchObject({
      filesCopied: 412,
      filesSkipped: 3,
      filesRefused: 0,
      destination: '/home/voce/espelhos/projeto',
      lastError: null,
    });
  });

  it('copiar ZERO é sucesso, e a contagem 0 é gravada como número', async () => {
    const { repo, atual } = mirrorRepo();
    const uc = new RecordMirrorSyncUseCase(projectRepo(projeto()), repo);

    const resultado = await uc.execute(PROJETO, {
      ok: true,
      destination: '/home/voce/espelhos/projeto',
      filesCopied: 0,
      filesSkipped: 0,
      filesRefused: 0,
    });

    expect(resultado.status).toBe('synced');
    expect(atual()?.filesCopied).toBe(0);
    expect(atual()?.lastSyncedAt).toBeInstanceOf(Date);
  });

  it('falha grava o erro NOMEADO e NÃO apaga a última sincronização boa', async () => {
    const { repo, atual } = mirrorRepo();
    const uc = new RecordMirrorSyncUseCase(projectRepo(projeto()), repo);

    await uc.execute(PROJETO, {
      ok: true,
      destination: '/home/voce/espelhos/projeto',
      filesCopied: 412,
      filesSkipped: 0,
      filesRefused: 0,
    });
    const sucesso = atual()?.lastSyncedAt;

    const resultado = await uc.execute(PROJETO, {
      ok: false,
      destination: '/home/voce/espelhos/projeto',
      error: 'o espelho não conseguiu listar o trabalho com o git',
    });

    expect(resultado.status).toBe('failed');
    expect(atual()?.lastSyncedAt).toEqual(sucesso);
    expect(atual()?.filesCopied).toBe(412);
    expect(atual()?.lastError).toContain('git');
  });

  it('falha SEM destino não apaga o destino da última cópia que funcionou', async () => {
    const { repo, atual } = mirrorRepo();
    const uc = new RecordMirrorSyncUseCase(projectRepo(projeto()), repo);

    await uc.execute(PROJETO, {
      ok: true,
      destination: '/home/voce/espelhos/projeto',
      filesCopied: 1,
      filesSkipped: 0,
      filesRefused: 0,
    });

    await uc.execute(PROJETO, {
      ok: false,
      error: 'o destino não foi concedido nesta conexão',
    });

    expect(atual()?.destination).toBe('/home/voce/espelhos/projeto');
  });

  it('falha sem mensagem ganha frase PRÓPRIA, nunca string vazia', async () => {
    const { repo, atual } = mirrorRepo();
    const uc = new RecordMirrorSyncUseCase(projectRepo(projeto()), repo);

    await uc.execute(PROJETO, { ok: false });

    expect(atual()?.lastError).toBe(
      'O agente local reportou falha sem mensagem.',
    );
  });

  it('mensagem longa é CORTADA dizendo que foi cortada', async () => {
    const { repo, atual } = mirrorRepo();
    const uc = new RecordMirrorSyncUseCase(projectRepo(projeto()), repo);

    await uc.execute(PROJETO, { ok: false, error: 'x'.repeat(5000) });

    expect(atual()?.lastError).toContain('(mensagem cortada)');
    expect(atual()!.lastError!.length).toBeLessThan(5000);
  });

  it('contagem negativa ou não-numérica vira 0 — a coluna é integer', async () => {
    const { repo, atual } = mirrorRepo();
    const uc = new RecordMirrorSyncUseCase(projectRepo(projeto()), repo);

    await uc.execute(PROJETO, {
      ok: true,
      destination: '/d',
      filesCopied: -7,
      filesSkipped: Number.NaN,
      filesRefused: null,
    });

    expect(atual()).toMatchObject({
      filesCopied: 0,
      filesSkipped: 0,
      filesRefused: 0,
    });
  });

  it('projeto com destino JÁ LIMPO ainda registra — a rodada aconteceu', async () => {
    const { repo, atual } = mirrorRepo();
    const uc = new RecordMirrorSyncUseCase(
      projectRepo(projeto({ mirrorPath: null })),
      repo,
    );

    await uc.execute(PROJETO, { ok: false, error: 'destino não concedido' });

    expect(atual()?.lastError).toBe('destino não concedido');
  });

  it('projeto inexistente é 404 — e é o engine quem só loga isso', async () => {
    const { repo } = mirrorRepo();
    const uc = new RecordMirrorSyncUseCase(projectRepo(null), repo);

    await expect(uc.execute(PROJETO, { ok: true })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('GetProjectMirrorStateUseCase (RN-517)', () => {
  it('projeto que nunca sincronizou responde "never" com tudo nulo', async () => {
    const { repo } = mirrorRepo(null);
    const uc = new GetProjectMirrorStateUseCase(projectRepo(projeto()), repo);

    const visao = await uc.execute(PROJETO);

    expect(visao).toEqual({
      mirrorPath: '/home/voce/espelhos/projeto',
      status: 'never',
      lastSyncedAt: null,
      filesCopied: null,
      filesSkipped: null,
      filesRefused: null,
      lastDestination: null,
      lastError: null,
      lastErrorAt: null,
    });
  });

  it('os TRÊS estados são distinguíveis na leitura, e nenhum vira o outro', async () => {
    const { repo } = mirrorRepo();
    const gravar = new RecordMirrorSyncUseCase(projectRepo(projeto()), repo);
    const ler = new GetProjectMirrorStateUseCase(projectRepo(projeto()), repo);

    expect((await ler.execute(PROJETO)).status).toBe('never');

    await gravar.execute(PROJETO, {
      ok: true,
      destination: '/home/voce/espelhos/projeto',
      filesCopied: 0,
      filesSkipped: 0,
      filesRefused: 0,
    });
    const sincronizado = await ler.execute(PROJETO);
    expect(sincronizado.status).toBe('synced');
    // "sincronizou e não copiou nada" NÃO é "nunca sincronizou": a data está
    // lá, e a contagem é 0 (número), não `null`.
    expect(sincronizado.filesCopied).toBe(0);
    expect(sincronizado.lastSyncedAt).not.toBeNull();

    await gravar.execute(PROJETO, { ok: false, error: 'git falhou' });
    const falhou = await ler.execute(PROJETO);
    expect(falhou.status).toBe('failed');
    // E a última sincronização boa continua legível ao lado do erro.
    expect(falhou.lastSyncedAt).toBe(sincronizado.lastSyncedAt);
    expect(falhou.lastError).toBe('git falhou');
  });

  it('destino trocado: `mirrorPath` é o de hoje, `lastDestination` é o congelado', async () => {
    const { repo } = mirrorRepo();
    const gravar = new RecordMirrorSyncUseCase(projectRepo(projeto()), repo);
    await gravar.execute(PROJETO, {
      ok: true,
      destination: '/home/voce/espelhos/antigo',
      filesCopied: 2,
      filesSkipped: 0,
      filesRefused: 0,
    });

    const ler = new GetProjectMirrorStateUseCase(
      projectRepo(projeto({ mirrorPath: '/home/voce/espelhos/novo' })),
      repo,
    );
    const visao = await ler.execute(PROJETO);

    expect(visao.mirrorPath).toBe('/home/voce/espelhos/novo');
    expect(visao.lastDestination).toBe('/home/voce/espelhos/antigo');
  });

  it('projeto inexistente é 404', async () => {
    const { repo } = mirrorRepo();
    const uc = new GetProjectMirrorStateUseCase(projectRepo(null), repo);

    await expect(uc.execute(PROJETO)).rejects.toBeInstanceOf(NotFoundException);
  });
});
