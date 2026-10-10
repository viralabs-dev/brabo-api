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

export interface ResumoDoContextoDaSessao {
  /** A sessão pedida e as de EXECUÇÃO ligadas a ela (RN-828). */
  sessoesLidas: string[];
  regras: number;
  decisoes: number;
  artefatosPorAgente: ArtefatosDoAgente[];
  arquivosTocados: {
    /** Os mais recentes primeiro, até `TETO_DE_ARQUIVOS_TOCADOS`. */
    itens: ArquivoTocado[];
    /** Total real, mesmo quando `itens` foi cortado. */
    total: number;
  };
}

export const TETO_DE_ARQUIVOS_TOCADOS = 100;

export abstract class SessionContextSummaryRepository {
  abstract resumir(
    projectId: string,
    sessionId: string,
  ): Promise<ResumoDoContextoDaSessao>;
}
