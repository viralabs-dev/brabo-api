import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DrizzleDb } from '../../infrastructure/persistence/drizzle/drizzle-client';
import { proposedActions } from '../../db/schema';
import { PROTECTED_BRANCHES } from '../../domain/actions/protected-branches';

/**
 * Cálculo PURO do funil de entrega e DORA parcial (ADR 0089), extraído de
 * `apps/api/scripts/analise-funil.ts` (RN-407).
 *
 * ## Por que este módulo existe
 *
 * Até aqui só o script CLI (`pnpm --filter api analise:funil`) sabia calcular
 * estas métricas. O PO precisava LER o mesmo relatório dentro do turno
 * ([RN-164](../../../../../docs/business-rules.md#rn-164) já estabeleceu o
 * padrão: agente que escreve precisa poder reler o que já existe), e um
 * caso de uso em `src/` não pode importar de `scripts/` — a direção é sempre
 * `scripts/` → `src/`, nunca o contrário. Então as funções PURAS (sem I/O) e
 * a query que hoje montava o dado em `main()` migraram para cá; o script
 * passou a REEXPORTAR daqui em vez de definir localmente, e nenhuma
 * assinatura ou comportamento mudou — é por isso que
 * `apps/api/test/scripts/analise-funil.spec.ts` continua verde sem ser
 * tocado.
 *
 * A leitura do PO (`ListProductMetricsUseCase`,
 * `apps/api/src/application/use-cases/backlog/list-product-metrics.use-case.ts`)
 * e o script `analise-funil.ts` chamam as MESMAS funções sobre a MESMA
 * query — duas contas do mesmo fato divergiriam no primeiro ajuste.
 */

/** As três ações git que o funil enxerga — o resto de `actionType` é ruído aqui. */
export const ACOES_DO_FUNIL = ['git_commit', 'pr_open', 'git_merge'] as const;
export type AcaoDoFunil = (typeof ACOES_DO_FUNIL)[number];

/** Forma mínima que a query devolve — deliberadamente mais estreita que o schema. */
export interface AcaoGit {
  sessionId: string;
  actionType: string;
  status: string;
  executionResult: Record<string, unknown> | null;
  updatedAt: Date;
}

const EXECUTADAS = 'executed';

function executadasDoTipo(acoes: AcaoGit[], tipo: AcaoDoFunil): AcaoGit[] {
  return acoes.filter((a) => a.actionType === tipo && a.status === EXECUTADAS);
}

export interface EtapaFunil {
  etapa: string;
  sessoes: number;
  /** `null` na primeira etapa — não há "conversão de" nada. */
  taxaDaEtapaAnterior: number | null;
}

export interface FunilResultado {
  etapas: EtapaFunil[];
  sessoesComCommit: string[];
  sessoesComPr: string[];
  sessoesComMerge: string[];
}

/**
 * Quantas sessões produziram pelo menos um commit / PR aberta / PR mergeada,
 * e a taxa de conversão entre etapas consecutivas. Conta SESSÃO, não ação —
 * uma sessão com três commits e uma PR entra uma vez em cada etapa que
 * alcançou.
 */
export function calcularFunil(acoes: AcaoGit[]): FunilResultado {
  const sessoesComCommit = new Set(
    executadasDoTipo(acoes, 'git_commit').map((a) => a.sessionId),
  );
  const sessoesComPr = new Set(
    executadasDoTipo(acoes, 'pr_open').map((a) => a.sessionId),
  );
  const sessoesComMerge = new Set(
    executadasDoTipo(acoes, 'git_merge').map((a) => a.sessionId),
  );

  const taxa = (numerador: number, denominador: number): number | null =>
    denominador === 0 ? null : numerador / denominador;

  const etapas: EtapaFunil[] = [
    {
      etapa: 'sessão produziu commit',
      sessoes: sessoesComCommit.size,
      taxaDaEtapaAnterior: null,
    },
    {
      etapa: 'commit → PR aberta',
      sessoes: sessoesComPr.size,
      taxaDaEtapaAnterior: taxa(sessoesComPr.size, sessoesComCommit.size),
    },
    {
      etapa: 'PR aberta → merge',
      sessoes: sessoesComMerge.size,
      taxaDaEtapaAnterior: taxa(sessoesComMerge.size, sessoesComPr.size),
    },
  ];

  return {
    etapas,
    sessoesComCommit: [...sessoesComCommit],
    sessoesComPr: [...sessoesComPr],
    sessoesComMerge: [...sessoesComMerge],
  };
}

export interface LeadTime {
  sessionId: string;
  primeiroCommitEm: Date;
  primeiroMergeEm: Date;
  leadTimeMs: number;
}

/**
 * Lead time real: do primeiro `git_commit` executado ao primeiro `git_merge`
 * executado, por sessão. Só entra sessão com os dois — a mesma regra do
 * funil, sem inventar tempo para quem não chegou lá.
 *
 * Merge anterior ao commit (sessão com duas levas, ou dado de fixture
 * incoerente) é descartado em vez de virar lead time negativo.
 */
export function calcularLeadTimes(acoes: AcaoGit[]): LeadTime[] {
  const primeiroPorSessao = (lista: AcaoGit[]): Map<string, Date> => {
    const mapa = new Map<string, Date>();
    for (const a of lista) {
      const atual = mapa.get(a.sessionId);
      if (!atual || a.updatedAt < atual) mapa.set(a.sessionId, a.updatedAt);
    }
    return mapa;
  };

  const commits = primeiroPorSessao(executadasDoTipo(acoes, 'git_commit'));
  const merges = primeiroPorSessao(executadasDoTipo(acoes, 'git_merge'));

  const resultado: LeadTime[] = [];
  for (const [sessionId, primeiroCommitEm] of commits) {
    const primeiroMergeEm = merges.get(sessionId);
    if (!primeiroMergeEm) continue;
    if (primeiroMergeEm < primeiroCommitEm) continue;
    resultado.push({
      sessionId,
      primeiroCommitEm,
      primeiroMergeEm,
      leadTimeMs: primeiroMergeEm.getTime() - primeiroCommitEm.getTime(),
    });
  }
  return resultado;
}

/** Média simples em ms — `null` sem nenhum lead time para mediar. */
export function leadTimeMedioMs(leadTimes: LeadTime[]): number | null {
  if (leadTimes.length === 0) return null;
  const soma = leadTimes.reduce((acc, l) => acc + l.leadTimeMs, 0);
  return soma / leadTimes.length;
}

export interface FrequenciaPorDia {
  dia: string; // YYYY-MM-DD
  merges: number;
}

/**
 * Deployment frequency real: `git_merge` executado cujo `targetBranch` é uma
 * branch PROTEGIDA (dev/qa/main — `rc` também está na lista por não ter sido
 * removida de `PROTECTED_BRANCHES`, ver CLAUDE.md), agrupado por dia.
 *
 * Cruza só por REFERÊNCIA com o gate `backmerge` (`docs/gates.yml`): a
 * evidência dele é CI, em `.release/gate.json`, fora do alcance de um script
 * que só lê o banco — não há junção de dado aqui, só o mesmo recorte de
 * branch que o gate observa.
 */
export function deploymentFrequencyPorDia(
  acoes: AcaoGit[],
  branchesProtegidas: readonly string[] = PROTECTED_BRANCHES,
): FrequenciaPorDia[] {
  const merges = executadasDoTipo(acoes, 'git_merge').filter((a) => {
    const alvo = a.executionResult?.targetBranch;
    return typeof alvo === 'string' && branchesProtegidas.includes(alvo);
  });

  const porDia = new Map<string, number>();
  for (const m of merges) {
    const dia = m.updatedAt.toISOString().slice(0, 10);
    porDia.set(dia, (porDia.get(dia) ?? 0) + 1);
  }

  return [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dia, merges]) => ({ dia, merges }));
}

/**
 * A query que `analise-funil.ts#main()` montava inline (linhas ~274-289
 * antes da extração): as três ações git do funil, do projeto, em qualquer
 * status (o filtro por `EXECUTADAS` acontece nas funções puras acima, não
 * aqui — cada consumidor decide o que fazer com `pending`/`failed`).
 */
export async function buscarAcoesGitDoFunil(
  db: DrizzleDb,
  projectId: string,
): Promise<AcaoGit[]> {
  return (await db
    .select({
      sessionId: proposedActions.sessionId,
      actionType: proposedActions.actionType,
      status: proposedActions.status,
      executionResult: proposedActions.executionResult,
      updatedAt: proposedActions.updatedAt,
    })
    .from(proposedActions)
    .where(
      and(
        eq(proposedActions.projectId, projectId),
        inArray(proposedActions.actionType, [...ACOES_DO_FUNIL]),
      ),
    )
    .orderBy(asc(proposedActions.updatedAt))) as unknown as AcaoGit[];
}
