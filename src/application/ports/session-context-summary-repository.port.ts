/**
 * RN-827 — o que o painel "Contexto da sessão" conta da sessão INTEIRA.
 *
 * O painel lê uma cauda de 200 eventos e uma de 200 ações; numa sessão maior
 * que isso as contagens dele eram da janela e não da sessão (AT-498). Este
 * read model conta no SERVIDOR, sem tabela nova, e a tela SOMA o resultado à
 * janela que já carregou (o molde da RN-568).
 */
export interface ArtefatosDoAgente {
  actorId: string;
  /** PRs (`pr_open`/`open_adr_pr`) + épicos/histórias/tarefas que o agente gerou. */
  quantos: number;
}

export interface ArquivoTocado {
  actionId: string;
  path: string;
  additions: number;
  deletions: number;
}

/** RN-844 — uma regra de negócio da sessão, o mínimo para o cartão. */
export interface ItemDeRegra {
  eventId: string;
  seq: number;
  actorId: string;
  titulo: string | null;
  descricao: string | null;
  /** Quantas referências de origem a regra cita (`origin`). */
  origens: number;
}

/** RN-844 — uma decisão registrada (`artifact.decision_record`). */
export interface ItemDeDecisao {
  eventId: string;
  seq: number;
  actorId: string;
  escolha: string | null;
  contexto: string | null;
}

export interface ResumoDoContextoDaSessao {
  /** A sessão pedida e as de EXECUÇÃO ligadas a ela (RN-828). */
  sessoesLidas: string[];
  regras: number;
  decisoes: number;
  /** RN-844: as mais recentes primeiro, até `TETO_DE_ITENS_DO_CONTEXTO`; o total é `regras`. */
  itensDeRegras: ItemDeRegra[];
  /** RN-844: as mais recentes primeiro, até `TETO_DE_ITENS_DO_CONTEXTO`; o total é `decisoes`. */
  itensDeDecisoes: ItemDeDecisao[];
  artefatosPorAgente: ArtefatosDoAgente[];
  arquivosTocados: {
    /** Os mais recentes primeiro, até `TETO_DE_ARQUIVOS_TOCADOS`. */
    itens: ArquivoTocado[];
    /** Total real, mesmo quando `itens` foi cortado. */
    total: number;
    /**
     * RN-844: PRs da sessão (e da execução ligada) cujos arquivos NÃO foram
     * lidos — além de `TETO_DE_PRS_LIDAS`, ou cujo diff o provider recusou.
     * Zero quer dizer que a lista cobre todas as PRs.
     */
    prsNaoLidas: number;
  };
}

/** RN-844 — uma PR aberta numa das sessões lidas, a mais recente primeiro. */
export interface PrDaSessao {
  actionId: string;
  pullRequestId: string;
}

export const TETO_DE_ARQUIVOS_TOCADOS = 100;
/** RN-844: regras e decisões devolvidas como item (o número é o da sessão inteira). */
export const TETO_DE_ITENS_DO_CONTEXTO = 50;
/** RN-844: quantas PRs têm o diff lido por chamada — custo constante (ADR 0060). */
export const TETO_DE_PRS_LIDAS = 20;

export abstract class SessionContextSummaryRepository {
  abstract resumir(
    projectId: string,
    sessionId: string,
  ): Promise<ResumoDoContextoDaSessao>;

  /**
   * RN-844: as PRs (`pr_open`/`open_adr_pr`/`open_infra_pr` executadas, com
   * `pullRequestId`) das sessões lidas, as mais recentes primeiro, até
   * `teto`, e o total real.
   */
  abstract prsDasSessoes(
    projectId: string,
    sessoes: string[],
    teto: number,
  ): Promise<{ itens: PrDaSessao[]; total: number }>;
}
