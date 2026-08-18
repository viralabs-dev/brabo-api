import { describe, it, expect } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ListProductMetricsUseCase } from '../../../../src/application/use-cases/backlog/list-product-metrics.use-case';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import type { Project } from '../../../../src/domain/iam/project.entity';
import type { DrizzleDb } from '../../../../src/infrastructure/persistence/drizzle/drizzle-client';
import type { AcaoGit } from '../../../../src/application/services/funil-metrics';

/**
 * RN-407 — a leitura de métricas de produto que fecha o item B4 da auditoria
 * fluxo.yml × código: `docs/fluxo.yml` (papel `po`, entrada
 * `metricas-de-produto`) declarava `status: lacuna`; o script `analise:funil`
 * (ADR 0089) já calculava o dado, e o que faltava era o CASO DE USO que o PO
 * consegue chamar dentro do turno.
 *
 * Este teste NÃO reexercita o cálculo em si — `calcularFunil`/
 * `calcularLeadTimes`/`deploymentFrequencyPorDia` já são cobertos ponta a
 * ponta por `test/scripts/analise-funil.spec.ts`, e são as MESMAS funções
 * (extraídas para `src/application/services/funil-metrics.ts`). O que
 * importa aqui é a MONTAGEM do relatório: projeto inexistente, o total de
 * ações consideradas e o formato do envelope.
 */

const PROJETO = 'p1';

function projeto(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJETO,
    workspaceId: 'w1',
    name: 'exp003',
    slug: 'exp003',
    workspaceDirName: 'exp003',
    workspaceMode: 'container',
    workspacePath: null,
    createdBy: 'u1',
    taskBudgetMicros: null,
    maxConsecutiveBlocked: null,
    storyPromotion: 'manual',
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
    ...overrides,
  };
}

/**
 * Mimetiza só o pedaço da cadeia do Drizzle que
 * `buscarAcoesGitDoFunil` chama (`select().from().where().orderBy()`),
 * sem subir banco nenhum — o mesmo espírito de mock de porta que o resto
 * da suite usa para os repositórios.
 */
function fakeDb(acoes: AcaoGit[]): DrizzleDb {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve(acoes),
        }),
      }),
    }),
  } as unknown as DrizzleDb;
}

function montar(db: DrizzleDb, achado: Project | null) {
  const projects = {
    findById: (id: string) => {
      expect(id).toBe(PROJETO);
      return Promise.resolve(achado);
    },
  } as unknown as ProjectRepository;

  return new ListProductMetricsUseCase(db, projects);
}

function acao(
  sessionId: string,
  actionType: string,
  opts: {
    status?: string;
    executionResult?: Record<string, unknown> | null;
    updatedAt?: Date;
  } = {},
): AcaoGit {
  return {
    sessionId,
    actionType,
    status: opts.status ?? 'executed',
    executionResult: opts.executionResult ?? null,
    updatedAt: opts.updatedAt ?? new Date('2026-08-01T10:00:00.000Z'),
  };
}

describe('ListProductMetricsUseCase', () => {
  it('projeto inexistente lança NotFoundException', async () => {
    const caso = montar(fakeDb([]), null);

    await expect(caso.execute(PROJETO)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('monta o relatório com o funil, lead time e deployment frequency reais', async () => {
    const commitEm = new Date('2026-08-01T10:00:00.000Z');
    const mergeEm = new Date('2026-08-01T12:00:00.000Z');
    const acoes = [
      acao('s1', 'git_commit', { updatedAt: commitEm }),
      acao('s1', 'pr_open', { updatedAt: new Date('2026-08-01T11:00:00.000Z') }),
      acao('s1', 'git_merge', {
        updatedAt: mergeEm,
        executionResult: { targetBranch: 'dev' },
      }),
    ];

    const caso = montar(fakeDb(acoes), projeto());
    const relatorio = await caso.execute(PROJETO);

    expect(relatorio.project).toEqual({ id: PROJETO, name: 'exp003' });
    expect(relatorio.totalActionsConsidered).toBe(3);
    expect(relatorio.funnel.etapas.map((e) => e.sessoes)).toEqual([1, 1, 1]);
    expect(relatorio.leadTimes.perSession).toEqual([
      {
        sessionId: 's1',
        primeiroCommitEm: commitEm,
        primeiroMergeEm: mergeEm,
        leadTimeMs: 2 * 60 * 60 * 1000,
      },
    ]);
    expect(relatorio.leadTimes.averageMs).toBe(2 * 60 * 60 * 1000);
    expect(relatorio.deploymentFrequency).toEqual([
      { dia: '2026-08-01', merges: 1 },
    ]);
  });

  it('projeto sem ação git nenhuma responde relatório vazio, não erro', async () => {
    const caso = montar(fakeDb([]), projeto({ id: PROJETO, name: 'p-vazio' }));
    const relatorio = await caso.execute(PROJETO);

    expect(relatorio.totalActionsConsidered).toBe(0);
    expect(relatorio.funnel.sessoesComCommit).toEqual([]);
    expect(relatorio.leadTimes.perSession).toEqual([]);
    expect(relatorio.leadTimes.averageMs).toBeNull();
    expect(relatorio.deploymentFrequency).toEqual([]);
  });
});
