// O Brabo percebe a decisão REPETIDA e oferece fazê-la sozinho (AT-998,
// RN-1435..RN-1438). Puro e sem IO, no molde de `aceite-automatico-do-handoff.ts`:
// recebe o que o caso de uso já leu do event log e devolve se OFERECE, e o quê.
//
// Três categorias de decisão: `aprovacao` (a pessoa aprovou uma ação do mesmo
// tipo do mesmo agente), `handoff` (aceitou a mesma passagem) e `desbloqueio`
// (liberou uma tarefa pelo mesmo motivo). A oferta exige N decisões IGUAIS
// SEGUIDAS, sem recusa no meio, na janela de 24 h.

import { TIPOS_SEM_SEMPRE_PERMITIR } from '../actions/sempre-permitir';

export const N_DA_REPETICAO = 3;
export const JANELA_DA_REPETICAO_MS = 24 * 60 * 60 * 1000;

export type CategoriaDaDecisao = 'aprovacao' | 'handoff' | 'desbloqueio';
export type ResultadoDaDecisao = 'ok' | 'recusa' | 'ruim';

export interface Decisao {
  categoria: CategoriaDaDecisao;
  /** `aprovacao` = actionType; `handoff` = `de->para`; `desbloqueio` = motivo normalizado. */
  chave: string;
  /** `aprovacao` = o agente que propôs ('' quando o log não diz); nos outros, ''. */
  escopo: string;
  resultado: ResultadoDaDecisao;
  em: Date;
}

/** O que o evento do log carrega — o mínimo, sem depender da entidade. */
export interface EventoDeDecisao {
  type: string;
  createdAt: Date;
  payload: unknown;
}

/** Aprovar isto NUNCA é oferecido (além dos tipos de `TIPOS_SEM_SEMPRE_PERMITIR`). */
const NUNCA_OFERECER = ['terminal', 'propose_execution_plan'] as const;

export const OPCOES_DO_OUTRO_CAMINHO = [
  'trocar_modelo',
  'pedir_ao_dev_lead',
  'arquivar',
] as const;

export type MotivoSemOferta =
  | 'tipo_nunca_automatizavel'
  | 'repositorio_nao_local'
  | 'ja_tratada'
  | 'sem_repeticao';

export type Oferta =
  | {
      oferecer: true;
      assinatura: string;
      categoria: CategoriaDaDecisao;
      chave: string;
      escopo: string;
      n: number;
    }
  | { oferecer: false; motivo: MotivoSemOferta }
  | {
      oferecer: 'outro_caminho';
      assinatura: string;
      opcoes: typeof OPCOES_DO_OUTRO_CAMINHO;
    };

export interface ContextoDaOferta {
  agora: Date;
  /** Projeto com repositório `local` e nenhuma credencial de git (decisão 3 da AT-953). */
  repositorioLocalSemCredencial: boolean;
  /** Assinaturas já oferecidas, recusadas ou viradas regra: a oferta não volta. */
  jaTratadas: ReadonlySet<string>;
}

export const assinaturaDe = (
  d: Pick<Decisao, 'categoria' | 'chave' | 'escopo'>,
) => `${d.categoria}|${d.chave}|${d.escopo}`;

/** A chave da linha em `automacoes_do_projeto` (a unique é projeto+categoria+chave). */
export const chaveDaRegra = (d: Pick<Decisao, 'chave' | 'escopo'>) =>
  d.escopo ? `${d.chave}@${d.escopo}` : d.chave;

/** Motivo de bloqueio comparável: sem números/ids, sem pontuação de rota. */
export function normalizarMotivo(motivo: string): string {
  return motivo
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, '#')
    .replace(/\d+/g, '#')
    .replace(/[^a-z0-9#._: -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/**
 * Este TIPO de ação pode virar regra? `open_infra_pr` é a única exceção ao
 * teto de `TIPOS_SEM_SEMPRE_PERMITIR` (decisão 3 da AT-953), e só em
 * repositório local sem credencial — em outro provider a PR publica (RN-418).
 */
export function tipoAutomatizavel(
  actionType: string,
  repositorioLocalSemCredencial: boolean,
): MotivoSemOferta | null {
  if ((NUNCA_OFERECER as readonly string[]).includes(actionType)) {
    return 'tipo_nunca_automatizavel';
  }
  if (actionType === 'open_infra_pr') {
    return repositorioLocalSemCredencial ? null : 'repositorio_nao_local';
  }
  if ((TIPOS_SEM_SEMPRE_PERMITIR as readonly string[]).includes(actionType)) {
    return 'tipo_nunca_automatizavel';
  }
  return null;
}

type Payload = Record<string, unknown>;
const texto = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Lê as decisões HUMANAS do log (em ordem crescente). Aceite automático,
 * retomada automática e decisão tomada por uma regra não contam: a regra agindo
 * não é a pessoa decidindo de novo. Desbloqueio que volta a bloquear vira `ruim`.
 */
export function decisoesDosEventos(eventos: EventoDeDecisao[]): Decisao[] {
  const out: Decisao[] = [];
  const ultimoDesbloqueioDaTarefa = new Map<string, Decisao>();
  const ordenados = [...eventos].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  for (const e of ordenados) {
    const p = (e.payload ?? {}) as Payload;
    if (
      e.type === 'proposed_action.approved' ||
      e.type === 'proposed_action.denied'
    ) {
      const chave = texto(p.actionType);
      if (!chave) continue;
      out.push({
        categoria: 'aprovacao',
        chave,
        escopo: texto(p.agente),
        resultado: e.type === 'proposed_action.approved' ? 'ok' : 'recusa',
        em: e.createdAt,
      });
    } else if (e.type === 'handoff.accepted') {
      if (p.automatico || p.implicito || !texto(p.fromAgent)) continue;
      out.push({
        categoria: 'handoff',
        chave: `${texto(p.fromAgent)}->${texto(p.toAgent)}`,
        escopo: '',
        resultado: 'ok',
        em: e.createdAt,
      });
    } else if (e.type === 'backlog.task_unblocked') {
      if (p.retomadaAutomatica || p.automacao || !texto(p.motivo)) continue;
      const d: Decisao = {
        categoria: 'desbloqueio',
        chave: normalizarMotivo(texto(p.motivo)),
        escopo: '',
        resultado: 'ok',
        em: e.createdAt,
      };
      out.push(d);
      ultimoDesbloqueioDaTarefa.set(texto(p.taskId), d);
    } else if (e.type === 'backlog.task_blocked') {
      const d = ultimoDesbloqueioDaTarefa.get(texto(p.taskId));
      if (d) d.resultado = 'ruim';
      ultimoDesbloqueioDaTarefa.delete(texto(p.taskId));
    }
  }
  return out;
}

/**
 * `historico` JÁ inclui a decisão que acabou de acontecer (o caso de uso chama
 * depois do commit) e `atual` é ela. O anti-laço (decisão 2 da AT-953): a mesma
 * assinatura de desbloqueio com resultado ruim N vezes NUNCA é automatizada.
 */
export function avaliarRepeticao(
  atual: Decisao,
  historico: Decisao[],
  ctx: ContextoDaOferta,
): Oferta {
  const assinatura = assinaturaDe(atual);
  const serie = historico
    .filter(
      (d) =>
        assinaturaDe(d) === assinatura &&
        ctx.agora.getTime() - d.em.getTime() <= JANELA_DA_REPETICAO_MS,
    )
    .sort((a, b) => a.em.getTime() - b.em.getTime());

  if (atual.categoria === 'desbloqueio') {
    const ruins = serie.filter((d) => d.resultado === 'ruim').length;
    if (ruins >= N_DA_REPETICAO) {
      return {
        oferecer: 'outro_caminho',
        assinatura,
        opcoes: OPCOES_DO_OUTRO_CAMINHO,
      };
    }
  }

  if (atual.categoria === 'aprovacao') {
    const motivo = tipoAutomatizavel(
      atual.chave,
      ctx.repositorioLocalSemCredencial,
    );
    if (motivo) return { oferecer: false, motivo };
  }
  if (ctx.jaTratadas.has(assinatura)) {
    return { oferecer: false, motivo: 'ja_tratada' };
  }

  // Seguidas e sem recusa: conta de trás para frente até a primeira não-`ok`.
  let n = 0;
  for (let i = serie.length - 1; i >= 0 && serie[i].resultado === 'ok'; i--)
    n++;
  if (n < N_DA_REPETICAO) return { oferecer: false, motivo: 'sem_repeticao' };
  return {
    oferecer: true,
    assinatura,
    categoria: atual.categoria,
    chave: atual.chave,
    escopo: atual.escopo,
    n,
  };
}
