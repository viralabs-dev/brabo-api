import type { Handoff } from './handoff.entity';
import type { SessionEvent } from './session-event.entity';

/**
 * O clique "Estou pronto — a necessidade está validada" (ADR 0185) e o que ele
 * fecha. Regra pura: quem grava é `ConfirmReadinessUseCase`, quem consulta é
 * `AceiteImplicitoDoPoUseCase`.
 *
 * Um clique, três efeitos que antes eram três cliques:
 * - a PRONTIDÃO (`readiness.confirmed`, RN-142 — o piso "≥1 regra"), que
 *   dispara o `product_brief` no engine;
 * - a NECESSIDADE VALIDADA (`necessity.validated`, RN-657) — o gate
 *   `necessidade-validada` fecha no clique, com o `product_brief` produzido
 *   DEPOIS dele. O rótulo do botão diz isso, e é o rótulo que faz do clique
 *   um julgamento de MÉRITO e não só o piso estrutural (a objeção do ADR
 *   0095 à fusão);
 * - o ACEITE do handoff Criativo→PO (RN-658), que nasce depois, quando o
 *   Criativo termina o brief — aceito em nome da pessoa que clicou, com ela
 *   como ator e a marca `implicito` no payload.
 */

/**
 * O que o `readiness.confirmed` do clique novo carrega. Eventos gravados antes
 * do ADR 0185 têm payload `{}`: sem a marca, nenhum aceite implícito acontece
 * por causa deles — a sessão antiga segue com o card de aceite de sempre.
 */
export const MARCA_DO_ESTOU_PRONTO = {
  necessidadeValidada: true,
  aceiteImplicitoDoPo: true,
} as const;

/** A marca gravada no `handoff.accepted`/`agent.activated` do aceite implícito. */
export interface AceiteImplicito {
  via: 'readiness.confirmed';
  readinessEventId: string;
}

export interface DecisaoDeAceiteImplicito {
  userId: string;
  implicito: AceiteImplicito;
}

function temMarca(evento: SessionEvent): boolean {
  const payload = evento.payload as { aceiteImplicitoDoPo?: unknown } | null;
  return evento.actor.kind === 'user' && payload?.aceiteImplicitoDoPo === true;
}

/**
 * A oferta recém-criada deve ser aceita em nome de quem clicou "Estou pronto"?
 *
 * Só quando TODAS valem:
 * - é o handoff da prontidão — `criativo` → `po`, ainda `offered`, NESTA
 *   sessão (uma oferta vigente de outra sessão não é aceita daqui: o aceite
 *   só vale na sessão do handoff, `AcceptHandoffUseCase`);
 * - leva o `product_brief` como artefato, e esse brief nasceu DEPOIS do
 *   `readiness.confirmed` marcado mais recente — é o brief que aquele clique
 *   pediu. O handoff MANUAL (RN-633) nunca leva artefato, então nunca entra.
 *
 * Devolve quem aceita (o ator humano do clique) e a marca; `null` quando não
 * cabe, e aí a oferta fica `offered` com o card de sempre.
 */
export function decidirAceiteImplicitoDoPo(
  oferta: Pick<
    Handoff,
    'sessionId' | 'fromAgent' | 'toAgent' | 'status' | 'artifactId'
  >,
  sessionId: string,
  prontidoes: readonly SessionEvent[],
  briefs: readonly SessionEvent[],
): DecisaoDeAceiteImplicito | null {
  if (oferta.sessionId !== sessionId) return null;
  if (oferta.fromAgent !== 'criativo' || oferta.toAgent !== 'po') return null;
  if (oferta.status !== 'offered' || !oferta.artifactId) return null;

  const clique = [...prontidoes]
    .filter(temMarca)
    .sort((a, b) => b.seq - a.seq)[0];
  if (!clique) return null;

  const brief = briefs.find((b) => b.id === oferta.artifactId);
  if (!brief || brief.seq <= clique.seq) return null;

  return {
    userId: clique.actor.id,
    implicito: { via: 'readiness.confirmed', readinessEventId: clique.id },
  };
}
