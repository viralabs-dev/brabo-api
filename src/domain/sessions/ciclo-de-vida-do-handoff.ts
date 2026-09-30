// Ciclo de vida da OFERTA de handoff (ADR 0182, RN-635).
//
// Puro e sem framework, como `agent-activation.ts`: recebe as ofertas JÁ
// carregadas e decide. O IO (travar, ler, gravar, emitir evento) mora nos casos
// de uso.
//
// ## O que o uso real mostrou
//
// `handoffs` só conhecia `offered`/`accepted`, sem expiração, supersessão nem
// dedupe. Cada oferta era uma linha nova: o duplo clique em "arquitetura
// pronta" (ou duas abas) dava duas ofertas ao Infra e duas ao Dev Lead; o
// AppSec oferecia o threat model de CADA história aos mesmos três destinos; e
// uma oferta a um agente que já estava ativo ficava `offered` para sempre,
// acionável na tela, porque nada a encerrava.
//
// ## A invariante
//
// No máximo UMA oferta `offered` por (projeto, destino). A que deixa de ser a
// vigente vira `superseded`, com evento `handoff.superseded` — a linha muda de
// status como o aceite já fazia, o evento é append.

import type { Handoff } from './handoff.entity';

/** Motivo nomeado no `handoff.superseded` e no texto da recusa. */
export type MotivoDaSubstituicao = 'agente_ativado' | 'nova_oferta';

/** `reason` da recusa 409 de oferta a agente já ativo no projeto. */
export const RECUSA_AGENTE_JA_ATIVO = 'agente_ja_ativo' as const;

/** Desfecho de uma oferta que NÃO foi recusada. */
export type DesfechoDaOferta =
  // linha nova, sem oferta anterior pendente ao destino
  | 'criado'
  // linha nova, e a(s) anterior(es) pendente(s) ao destino viraram `superseded`
  | 'substituiu_oferta'
  // nenhuma linha nova: a oferta pendente que já existia é devolvida
  | 'ja_oferecido';

export interface PedidoDeOferta {
  sessionId: string;
  artifactId: string | null;
  /**
   * `true` = "só se ninguém recebeu ainda": qualquer oferta pendente ao destino
   * no projeto é devolvida, sem substituir (AppSec, RN-636 — o threat model de
   * uma história não tira do ar o de outra que ainda espera aceite).
   */
  seAusente?: boolean;
}

export type DecisaoDeOferta =
  | { tipo: 'reusar'; vigente: Handoff; substituir: Handoff[] }
  | { tipo: 'criar'; substituir: Handoff[] };

/**
 * Decide o que fazer com uma oferta nova diante das pendentes ao MESMO destino
 * no projeto (`pendentes` em ordem de criação).
 *
 * - Sem pendente: cria.
 * - `seAusente`: devolve a mais recente e não mexe em nada.
 * - Pendente na MESMA sessão cujo artefato a oferta nova não muda (o novo é
 *   `null` ou igual): devolve essa — é o duplo clique, as duas abas, o agente
 *   repetindo a ferramenta. As demais pendentes (dado de antes do ADR) viram
 *   `superseded` apontando para ela.
 * - Qualquer outro caso — artefato NOVO, ou a pendente mora noutra sessão:
 *   cria a nova e substitui TODAS as pendentes. Devolver a antiga perderia o
 *   artefato novo (o brief reescrito, o threat model de outra história), e
 *   devolver uma oferta de OUTRA sessão deixaria quem pediu sem nada para
 *   aceitar na conversa em que está — e se a outra sessão já fechou, sem nada
 *   para aceitar em lugar nenhum (RN-581 recusa aceite em sessão encerrada).
 */
export function decidirOferta(
  pendentes: readonly Handoff[],
  pedido: PedidoDeOferta,
): DecisaoDeOferta {
  if (pendentes.length === 0) return { tipo: 'criar', substituir: [] };

  if (pedido.seAusente) {
    return {
      tipo: 'reusar',
      vigente: pendentes[pendentes.length - 1],
      substituir: [],
    };
  }

  const mesma = [...pendentes]
    .reverse()
    .find(
      (h) =>
        h.sessionId === pedido.sessionId &&
        (pedido.artifactId === null || h.artifactId === pedido.artifactId),
    );
  if (mesma) {
    return {
      tipo: 'reusar',
      vigente: mesma,
      substituir: pendentes.filter((h) => h.id !== mesma.id),
    };
  }

  return { tipo: 'criar', substituir: [...pendentes] };
}

/** A frase da recusa — é o texto que o modelo lê como resultado (RN-163). */
export function mensagemDeAgenteJaAtivo(
  toAgent: string,
  sessionId: string,
): string {
  return (
    `Handoff não criado: o agente "${toAgent}" já está ativo neste projeto ` +
    `(sessão ${sessionId}). Oferecer de novo não o ativaria outra vez — ` +
    `o artefato, se houver, continua registrado; fale com ele na sessão em ` +
    `que está ativo.`
  );
}
