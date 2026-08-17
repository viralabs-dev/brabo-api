import { describe, expect, it } from 'vitest';
import {
  calcularFunil,
  calcularLeadTimes,
  deploymentFrequencyPorDia,
  leadTimeMedioMs,
  type AcaoGit,
} from '../../scripts/analise-funil';

/**
 * O relatório dos papéis `analytics`/`delivery-metricas` (docs/fluxo.yml,
 * ADR 0089). Só as funções PURAS — a parte que fala com o banco é o
 * `select` do `main()`, exercitado por execução real (mesmo padrão de
 * `medir-execucao.spec.ts`).
 */

let contador = 0;
function acao(
  sessionId: string,
  actionType: string,
  opts: {
    status?: string;
    executionResult?: Record<string, unknown> | null;
    updatedAt?: Date;
  } = {},
): AcaoGit {
  contador += 1;
  return {
    sessionId,
    actionType,
    status: opts.status ?? 'executed',
    executionResult: opts.executionResult ?? null,
    updatedAt: opts.updatedAt ?? new Date(2026, 7, 1, 12, 0, contador),
  };
}

describe('calcularFunil', () => {
  it('conta sessão uma vez por etapa, mesmo com várias ações do mesmo tipo', () => {
    const acoes = [
      acao('s1', 'git_commit'),
      acao('s1', 'git_commit'),
      acao('s1', 'pr_open'),
    ];

    const funil = calcularFunil(acoes);

    expect(funil.etapas).toEqual([
      { etapa: 'sessão produziu commit', sessoes: 1, taxaDaEtapaAnterior: null },
      { etapa: 'commit → PR aberta', sessoes: 1, taxaDaEtapaAnterior: 1 },
      { etapa: 'PR aberta → merge', sessoes: 0, taxaDaEtapaAnterior: 0 },
    ]);
  });

  it('taxa de conversão é fração real entre etapas', () => {
    const acoes = [
      acao('s1', 'git_commit'),
      acao('s2', 'git_commit'),
      acao('s1', 'pr_open'),
    ];

    const funil = calcularFunil(acoes);

    expect(funil.etapas[1].taxaDaEtapaAnterior).toBe(0.5);
  });

  it('sem commit nenhum, a conversão não divide por zero — vira null', () => {
    const funil = calcularFunil([]);

    expect(funil.etapas[1].taxaDaEtapaAnterior).toBeNull();
    expect(funil.etapas[2].taxaDaEtapaAnterior).toBeNull();
  });

  it('ação `pending`/`failed` não conta — só `executed` produziu efeito de verdade', () => {
    const acoes = [
      acao('s1', 'git_commit', { status: 'pending' }),
      acao('s1', 'pr_open', { status: 'failed' }),
    ];

    const funil = calcularFunil(acoes);

    expect(funil.sessoesComCommit).toEqual([]);
    expect(funil.sessoesComPr).toEqual([]);
  });
});

describe('calcularLeadTimes', () => {
  it('lead time é do primeiro commit ao primeiro merge da sessão', () => {
    const commitEm = new Date(2026, 7, 1, 10, 0, 0);
    const mergeEm = new Date(2026, 7, 1, 12, 0, 0);
    const acoes = [
      acao('s1', 'git_commit', { updatedAt: commitEm }),
      acao('s1', 'git_merge', { updatedAt: mergeEm }),
    ];

    const leadTimes = calcularLeadTimes(acoes);

    expect(leadTimes).toEqual([
      {
        sessionId: 's1',
        primeiroCommitEm: commitEm,
        primeiroMergeEm: mergeEm,
        leadTimeMs: 2 * 60 * 60 * 1000,
      },
    ]);
  });

  it('usa o PRIMEIRO commit e o PRIMEIRO merge quando há vários', () => {
    const primeiroCommit = new Date(2026, 7, 1, 9, 0, 0);
    const segundoCommit = new Date(2026, 7, 1, 10, 0, 0);
    const primeiroMerge = new Date(2026, 7, 1, 11, 0, 0);
    const segundoMerge = new Date(2026, 7, 1, 15, 0, 0);
    const acoes = [
      acao('s1', 'git_commit', { updatedAt: segundoCommit }),
      acao('s1', 'git_commit', { updatedAt: primeiroCommit }),
      acao('s1', 'git_merge', { updatedAt: segundoMerge }),
      acao('s1', 'git_merge', { updatedAt: primeiroMerge }),
    ];

    const [leadTime] = calcularLeadTimes(acoes);

    expect(leadTime.primeiroCommitEm).toEqual(primeiroCommit);
    expect(leadTime.primeiroMergeEm).toEqual(primeiroMerge);
  });

  it('sessão sem merge não entra — nada a medir ainda', () => {
    const acoes = [acao('s1', 'git_commit')];

    expect(calcularLeadTimes(acoes)).toEqual([]);
  });

  it('merge anterior ao commit é descartado, não vira lead time negativo', () => {
    const acoes = [
      acao('s1', 'git_commit', { updatedAt: new Date(2026, 7, 1, 12, 0, 0) }),
      acao('s1', 'git_merge', { updatedAt: new Date(2026, 7, 1, 10, 0, 0) }),
    ];

    expect(calcularLeadTimes(acoes)).toEqual([]);
  });
});

describe('leadTimeMedioMs', () => {
  it('média simples entre sessões', () => {
    const leadTimes = [
      {
        sessionId: 's1',
        primeiroCommitEm: new Date(0),
        primeiroMergeEm: new Date(0),
        leadTimeMs: 1000,
      },
      {
        sessionId: 's2',
        primeiroCommitEm: new Date(0),
        primeiroMergeEm: new Date(0),
        leadTimeMs: 3000,
      },
    ];

    expect(leadTimeMedioMs(leadTimes)).toBe(2000);
  });

  it('sem lead time nenhum, a média é null — não zero, que mentiria', () => {
    expect(leadTimeMedioMs([])).toBeNull();
  });
});

describe('deploymentFrequencyPorDia', () => {
  it('só conta merge em branch PROTEGIDA', () => {
    const acoes = [
      acao('s1', 'git_merge', {
        executionResult: { targetBranch: 'dev' },
        updatedAt: new Date(2026, 7, 1, 10, 0, 0),
      }),
      acao('s2', 'git_merge', {
        executionResult: { targetBranch: 'feature/x' },
        updatedAt: new Date(2026, 7, 1, 11, 0, 0),
      }),
    ];

    const frequencia = deploymentFrequencyPorDia(acoes, ['dev', 'qa', 'main']);

    expect(frequencia).toEqual([{ dia: '2026-08-01', merges: 1 }]);
  });

  it('agrupa por dia e ordena cronologicamente', () => {
    const acoes = [
      acao('s1', 'git_merge', {
        executionResult: { targetBranch: 'dev' },
        updatedAt: new Date(2026, 7, 3, 10, 0, 0),
      }),
      acao('s2', 'git_merge', {
        executionResult: { targetBranch: 'dev' },
        updatedAt: new Date(2026, 7, 1, 10, 0, 0),
      }),
      acao('s3', 'git_merge', {
        executionResult: { targetBranch: 'dev' },
        updatedAt: new Date(2026, 7, 1, 15, 0, 0),
      }),
    ];

    const frequencia = deploymentFrequencyPorDia(acoes, ['dev']);

    expect(frequencia.map((f) => f.dia)).toEqual([
      '2026-08-01',
      '2026-08-03',
    ]);
    expect(frequencia[0].merges).toBe(2);
  });

  it('merge `pending`/`failed` não conta — não houve deploy nenhum', () => {
    const acoes = [
      acao('s1', 'git_merge', {
        status: 'failed',
        executionResult: { targetBranch: 'dev' },
      }),
    ];

    expect(deploymentFrequencyPorDia(acoes, ['dev'])).toEqual([]);
  });
});
