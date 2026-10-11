/* eslint-disable @typescript-eslint/require-await -- dublês assíncronos sem await, de propósito */
import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ResumirContextoDaSessaoUseCase } from '../../../../src/application/use-cases/git/resumir-contexto-da-sessao.use-case';
import type { GetSessionContextSummaryUseCase } from '../../../../src/application/use-cases/sessions/get-session-context-summary.use-case';
import type { ReadProjectCodeUseCase } from '../../../../src/application/use-cases/git/read-project-code.use-case';
import {
  TETO_DE_ARQUIVOS_TOCADOS,
  TETO_DE_PRS_LIDAS,
  type ResumoDoContextoDaSessao,
  type SessionContextSummaryRepository,
} from '../../../../src/application/ports/session-context-summary-repository.port';

function resumo(): ResumoDoContextoDaSessao {
  return {
    sessoesLidas: ['s1', 'exec'],
    regras: 9,
    decisoes: 4,
    itensDeRegras: [],
    itensDeDecisoes: [],
    artefatosPorAgente: [],
    arquivosTocados: {
      itens: [
        { actionId: 'c1', path: 'commit.ts', additions: 1, deletions: 0 },
      ],
      total: 1,
      prsNaoLidas: 0,
    },
  };
}

function montar(opts: {
  base?: () => Promise<ResumoDoContextoDaSessao>;
  prs?: { itens: { actionId: string; pullRequestId: string }[]; total: number };
  diff?: (pr: string) => Promise<unknown>;
}) {
  const base = { execute: vi.fn(opts.base ?? (async () => resumo())) };
  const repo = {
    prsDasSessoes: vi.fn(async () => opts.prs ?? { itens: [], total: 0 }),
  };
  const codigo = {
    pullRequestDiff: vi.fn(async (_p: string, pr: string) =>
      opts.diff ? opts.diff(pr) : { files: [] },
    ),
  };
  const uc = new ResumirContextoDaSessaoUseCase(
    base as unknown as GetSessionContextSummaryUseCase,
    repo as unknown as SessionContextSummaryRepository,
    codigo as unknown as ReadProjectCodeUseCase,
  );
  return { uc, repo, codigo };
}

const arquivo = (path: string) => ({
  path,
  previousPath: null,
  status: 'modified',
  additions: 2,
  deletions: 1,
  patch: null,
});

describe('ResumirContextoDaSessaoUseCase (RN-844)', () => {
  it('lê os arquivos das PRs das sessões lidas (inclusive a de execução ligada), antes dos de commit', async () => {
    const { uc, repo, codigo } = montar({
      prs: {
        itens: [
          { actionId: 'a2', pullRequestId: 'pr-2' },
          { actionId: 'a1', pullRequestId: 'pr-1' },
        ],
        total: 2,
      },
      diff: async (pr) => ({ files: [arquivo(`${pr}.ts`)] }),
    });
    const r = await uc.execute('p1', 's1');
    expect(repo.prsDasSessoes).toHaveBeenCalledWith(
      'p1',
      ['s1', 'exec'],
      TETO_DE_PRS_LIDAS,
    );
    expect(codigo.pullRequestDiff).toHaveBeenCalledTimes(2);
    expect(r.arquivosTocados.itens.map((f) => f.path)).toEqual([
      'pr-2.ts',
      'pr-1.ts',
      'commit.ts',
    ]);
    expect(r.arquivosTocados.itens[0]).toMatchObject({
      actionId: 'a2',
      additions: 2,
      deletions: 1,
    });
    expect(r.arquivosTocados.total).toBe(3);
    expect(r.arquivosTocados.prsNaoLidas).toBe(0);
  });

  it('corta no teto de arquivos, conta PR fora do teto e diff que falhou em prsNaoLidas', async () => {
    const { uc } = montar({
      prs: {
        itens: [
          { actionId: 'a1', pullRequestId: 'pr-1' },
          { actionId: 'a2', pullRequestId: 'pr-quebrada' },
        ],
        total: 25,
      },
      diff: async (pr) => {
        if (pr === 'pr-quebrada') throw new Error('provider fora');
        return {
          files: Array.from({ length: 150 }, (_, i) => arquivo(`f${i}.ts`)),
        };
      },
    });
    const r = await uc.execute('p1', 's1');
    expect(r.arquivosTocados.itens).toHaveLength(TETO_DE_ARQUIVOS_TOCADOS);
    expect(r.arquivosTocados.total).toBe(151);
    expect(r.arquivosTocados.prsNaoLidas).toBe(23 + 1);
  });

  it('sem PR não chama o provider', async () => {
    const { uc, codigo } = montar({});
    const r = await uc.execute('p1', 's1');
    expect(codigo.pullRequestDiff).not.toHaveBeenCalled();
    expect(r.arquivosTocados.total).toBe(1);
  });

  it('sessão de outro projeto é 404 e não lê PR nenhuma', async () => {
    const { uc, repo, codigo } = montar({
      base: async () => {
        throw new NotFoundException('Sessão não encontrada');
      },
    });
    await expect(uc.execute('p1', 'sX')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.prsDasSessoes).not.toHaveBeenCalled();
    expect(codigo.pullRequestDiff).not.toHaveBeenCalled();
  });
});
