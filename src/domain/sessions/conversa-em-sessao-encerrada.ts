// Sessão terminal não aceita CONVERSA (RN-581, AT-072).
//
// Puro e sem framework, como `session-state-machine.ts`: quem traduz a recusa
// para 409 é a camada de aplicação.
//
// ## O que o caso real mostrou
//
// No `exp001` o heartbeat fechou a sessão com o Criativo esperando resposta, e
// o log continuou recebendo eventos por quatro minutos depois do `closed_at`.
// O funil (`AppendSessionEventUseCase`) nunca perguntava o estado da sessão, e
// os casos de uso da conversa também não: a única barreira era a web e o
// `join` do canal, e um canal JÁ conectado seguia vivo.
//
// ## Por que a lista é de CONVERSA, e não de "tudo que pode entrar"
//
// A direção natural seria uma lista de PERMITIDOS (o que entra numa sessão
// fechada). Ela foi medida e recusada: o que legitimamente escreve numa
// sessão fechada NÃO é o fechamento — `session.closed` é só linha de outbox,
// nunca `session_events` (`TransitionSessionUseCase`) —, e sim os
// CONSUMIDORES dele, e eles falam o vocabulário GENÉRICO do harness:
//
//  - o Psicólogo roda um `ToolLoop` contra a sessão JÁ fechada e grava
//    `tool.call`, `tool.result`, `agent.response`, `agent.error`,
//    `toolloop.limit_reached`/`toolloop.budget_exceeded`, além dos próprios
//    `psychologist.analysis_skipped`/`psychologist.analysis_failed`;
//  - a Anamnese grava `anamnese.run_skipped`/`anamnese.run_failed`;
//  - o humano decide DEPOIS do fechamento o que o fechamento produziu:
//    aceitar/descartar hipótese do Psicólogo, aprovar/negar ação.
//
// Uma lista de permitidos por TIPO recusaria o `tool.call` do Psicólogo junto
// com o do Criativo — o tipo é o mesmo, quem difere é o ATOR. Por isso a régua
// tem duas cláusulas, e cada uma responde uma pergunta diferente.
//
// ## Aprovação de ação fica FORA da recusa, por decisão
//
// `action.approved`/`action.denied` e os desfechos de execução continuam
// aceitos em sessão fechada. A ação é item de uma fila DURÁVEL
// (`proposed_actions`, página de Aprovações) que sobrevive à sessão; recusar a
// decisão deixaria uma pendência impossível de resolver para sempre. E o caso
// normal nem chega aqui: ação `pending` é trabalho pendente (RN-064), então o
// heartbeat não fecha a sessão por cima dela. Ela só existe fechada quando a
// sessão morreu por outra porta (api fora do ar, fechamento humano, crash) —
// exatamente quando alguém precisa conseguir decidir.

import type { Actor } from './session-event.entity';
import { isTerminal, type SessionStatus } from './session-state-machine';
import { SOLO_CONVERSATIONAL_AGENTS } from '../agents/agent-areas';

/**
 * Os agentes que CONVERSAM com o usuário dentro de uma sessão: um processo por
 * sessão no engine (`Engine.Sessions.Registry`, chaves `<agente>:<sessão>`).
 * `dev-lead` e `infra` são leads de área e por isso não estão em
 * `SOLO_CONVERSATIONAL_AGENTS`, mas conversam do mesmo jeito — é o que a lista
 * do engine que os PARA ao fechar (`Engine.Agents.Conversacionais`) também diz.
 */
export const AGENTES_CONVERSACIONAIS: ReadonlySet<string> = new Set([
  ...SOLO_CONVERSATIONAL_AGENTS,
  'dev-lead',
  'infra',
]);

/**
 * Tipos que SÓ existem como conversa, qualquer que seja o ator — a maior parte
 * gravada em nome do USUÁRIO, que não é agente e por isso a segunda cláusula
 * não pega. Um por caso de uso da conversa:
 */
export const TIPOS_DA_CONVERSA: ReadonlySet<string> = new Set([
  // o usuário fala (SendAgentMessage e o chat humano stateless)
  'chat.message',
  // o agente pergunta em formulário; o usuário responde
  'chat.structured_question',
  'chat.structured_question_answered',
  // limite de turno narrado pelos conversacionais (`LiveBroadcast`)
  'agent.status',
  // ActivateAgent
  'agent.activated',
  // CreateHandoff / AcceptHandoff
  'handoff.offered',
  'handoff.accepted',
  // ConfirmReadiness (Criativo), ValidateNecessity, OfferInfraHandoff
  'readiness.confirmed',
  'necessity.validated',
  'architecture.readiness_confirmed',
]);

/**
 * O evento é CONVERSA? Duas cláusulas, e as duas são necessárias:
 *
 * 1. o TIPO só existe como conversa (`TIPOS_DA_CONVERSA`); ou
 * 2. o ATOR é um agente conversacional — tudo que o Criativo, o PO etc.
 *    escrevem é a conversa continuando, inclusive o vocabulário genérico do
 *    laço (`agent.response`, `tool.call`, `artifact.*`), que o Psicólogo
 *    também usa, mas com OUTRO ator.
 */
export function ehEventoDeConversa(type: string, actor: Actor): boolean {
  if (TIPOS_DA_CONVERSA.has(type)) return true;
  return actor.kind === 'agent' && AGENTES_CONVERSACIONAIS.has(actor.id);
}

export class ConversaEmSessaoEncerradaError extends Error {
  /** O `reason` do corpo do 409 — o nome que o engine e a web reconhecem. */
  static readonly REASON = 'sessao_encerrada';

  constructor(
    readonly status: SessionStatus,
    readonly type: string,
  ) {
    super(
      `A sessão está encerrada ("${status}") e não aceita mais conversa: o ` +
        `evento "${type}" foi recusado. Abra uma sessão nova para continuar.`,
    );
    this.name = 'ConversaEmSessaoEncerradaError';
  }
}

/** Lança `ConversaEmSessaoEncerradaError` quando a combinação é recusada. */
export function garantirQueSessaoAceitaEvento(
  status: SessionStatus,
  type: string,
  actor: Actor,
): void {
  if (isTerminal(status) && ehEventoDeConversa(type, actor)) {
    throw new ConversaEmSessaoEncerradaError(status, type);
  }
}
