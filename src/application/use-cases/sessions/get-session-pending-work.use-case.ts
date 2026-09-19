import { Injectable } from '@nestjs/common';
import { HandoffRepository } from '../../ports/handoff-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { AGENTES_CONVERSACIONAIS } from '../../../domain/sessions/conversa-em-sessao-encerrada';

export interface SessionPendingWork {
  pending: boolean;
  /** O que está pendurado, para o log do engine dizer por que não fechou. */
  motivo: string | null;
  /**
   * Preenchido SÓ quando a única coisa pendurada é um agente conversacional
   * esperando o usuário (RN-581): o instante em que ele terminou o turno. É a
   * única pendência COM TETO, e quem aplica o teto é o engine
   * (`SESSION_CONVERSATION_IDLE_TIMEOUT_MS`) — a api diz desde quando, e não
   * decide por quanto tempo. `null` em todo outro caso, inclusive quando há
   * espera de conversa E um sinal sem teto: o sinal sem teto vence.
   */
  aguardandoUsuarioDesde: string | null;
}

/**
 * O que fecha um TURNO de conversa, de cada lado. O mais recente dos cinco diz
 * quem falou por último: se foi o agente, a conversa está esperando o usuário.
 *
 * Do lado do agente, `agent.error` conta como fim de turno de propósito: pela
 * RN-059 o agente diz no fio o que houve, e a próxima jogada — tentar de novo,
 * reformular — é do usuário, igual a uma resposta.
 */
const FALA_DO_AGENTE = [
  'agent.response',
  'chat.structured_question',
  'agent.error',
] as const;
const FALA_DO_USUARIO = [
  'chat.message',
  'chat.structured_question_answered',
] as const;
const FIM_DE_TURNO: readonly string[] = [...FALA_DO_AGENTE, ...FALA_DO_USUARIO];
const TIPOS_DA_FALA_DO_AGENTE: ReadonlySet<string> = new Set(FALA_DO_AGENTE);

const NADA_PENDENTE: SessionPendingWork = {
  pending: false,
  motivo: null,
  aguardandoUsuarioDesde: null,
};

/**
 * A sessão tem trabalho pendente?
 *
 * Existe porque o heartbeat fechava sessão por inatividade da ABA, não do
 * TRABALHO — 30 segundos sem ninguém olhando e a sessão morria. Numa execução
 * real isso deixou um handoff `offered` para o Arquiteto preso numa sessão
 * fechada: épico e quatro histórias existiam, e a cadeia não tinha como
 * seguir, porque não há onde aceitar um handoff de sessão morta.
 *
 * Fechar sessão é sobre o trabalho ter acabado, não sobre quem está olhando.
 */
@Injectable()
export class GetSessionPendingWorkUseCase {
  constructor(
    private readonly handoffs: HandoffRepository,
    private readonly proposedActions: ProposedActionRepository,
    private readonly sessionEvents: SessionEventRepository,
  ) {}

  async execute(sessionId: string): Promise<SessionPendingWork> {
    const abertos = (await this.handoffs.findBySession(sessionId)).filter(
      (h) => h.status === 'offered',
    );

    if (abertos.length > 0) {
      return {
        pending: true,
        motivo: `handoff ${abertos[0].fromAgent} → ${abertos[0].toAgent} aguardando aceite`,
        aguardandoUsuarioDesde: null,
      };
    }

    // Ação esperando decisão (achado V). É o MESMO defeito do handoff, um nível
    // abaixo: alguém está esperando VOCÊ, e fechar a sessão por inatividade da
    // aba deixa a espera órfã.
    //
    // Na execução do `hello-limpo` a sessão nasceu 23:34:12, uma ação ficou
    // `pending` às 23:34:13, e o heartbeat a fechou às 23:34:42 — exatamente os
    // 30s do timeout. O dev agent seguiu trabalhando por mais de uma hora numa
    // sessão que o banco dava por encerrada, e é isso que envenena toda métrica
    // por sessão: duração, custo e "quantas terminaram bem".
    //
    // Uma ação pendente é ainda mais forte que o handoff como sinal: ela
    // significa que um agente está SUSPENSO esperando o desfecho
    // ([RN-073](../../../../docs/business-rules/custo.md#rn-073)).
    const acao =
      await this.proposedActions.findOldestPendingInSession(sessionId);

    if (acao) {
      return {
        pending: true,
        motivo: `ação ${acao.actionType} de ${acao.actor?.id ?? 'um agente'} aguardando decisão`,
        aguardandoUsuarioDesde: null,
      };
    }

    // Turno de agente em andamento — o defeito real que fez esta sessão
    // fechar cedo. `AcceptHandoffUseCase` marca o handoff antigo como
    // `accepted` e ativa o próximo agente na hora, mas a ativação no engine é
    // `GenServer.cast` (fire-and-forget): entre o cast chegar e o agente
    // oferecer o handoff seguinte (ou terminar a conversa), NEM handoff
    // `offered` NEM `proposed_action` pendente existem — só o ping do canal
    // Phoenix segurava a sessão, e o PO podia levar até 12 iterações de LLM
    // pra terminar o kickoff.
    //
    // `agent.status` narra os limites de turno de todo agente conversacional
    // (Criativo/PO/Arquiteto/Dev Lead/Infra) e é PERSISTIDO no event log, não
    // só broadcastado no canal (`Engine.Sessions.LiveBroadcast.agent_status/4`,
    // ADR 0021) — o mesmo sinal que o painel do time já lê para derivar o
    // roster (`conversationalStatus` em `apps/web/src/lib/agent-status.ts`).
    // O último `agent.status` de CADA ator que já falou nesta sessão: se
    // algum for `working` sem um `idle` posterior, o agente está no meio do
    // turno.
    const statusEvents = await this.sessionEvents.listByTypeInSession(
      sessionId,
      'agent.status',
    );
    const ultimoPorAtor = new Map<string, (typeof statusEvents)[number]>();
    for (const evento of statusEvents) {
      ultimoPorAtor.set(evento.actor.id, evento);
    }
    const trabalhando = [...ultimoPorAtor.values()].find(
      (e) => (e.payload as { status?: string } | null)?.status === 'working',
    );

    if (trabalhando) {
      return {
        pending: true,
        motivo: `agente ${trabalhando.actor.id} em turno (agent.status working sem idle posterior)`,
        aguardandoUsuarioDesde: null,
      };
    }

    // QUARTO sinal (RN-411): dev agents (`Engine.Dev.DevAgentServer`) NUNCA
    // emitem `agent.status` — usam vocabulário próprio no event log,
    // `dev.*` (`Engine.Dev.AgentIo`). Sem este sinal o terceiro sinal acima
    // nunca enxerga um dev agent, e uma sessão de execução real fechava com
    // dev agents TRABALHANDO ou TRAVADOS esperando o usuário desbloquear
    // uma task (`dev.idle_tripped`, o circuit breaker da RN-047) — achado
    // real: cinco dev agents subiram, ficaram `idle_tripped`, e o heartbeat
    // de 30s fechou a sessão por baixo enquanto o usuário ainda estava
    // desbloqueando tarefas manualmente.
    //
    // Busca TODOS os tipos `dev.*` conhecidos para achar o ÚLTIMO evento de
    // verdade por agente — não só os que decidem `pending` abaixo — senão
    // um `dev.awaiting_gate`/`dev.idle` mais recente passaria despercebido
    // e um `dev.working` mais antigo seria tomado como o estado atual.
    const devEventLists = await Promise.all(
      DEV_EVENT_TYPES.map((type) =>
        this.sessionEvents.listByTypeInSession(sessionId, type),
      ),
    );
    const ultimoPorDevAgent = new Map<
      string,
      (typeof devEventLists)[number][number]
    >();
    for (const evento of devEventLists.flat()) {
      const atual = ultimoPorDevAgent.get(evento.actor.id);
      if (!atual || evento.seq > atual.seq) {
        ultimoPorDevAgent.set(evento.actor.id, evento);
      }
    }

    // Estes seis significam "tem trabalho rolando ou um humano precisa
    // agir" — travado esperando desbloqueio, esperando o gate de QA/SecOps
    // terminar, esperando decisão de aprovação, ou esperando alguém subir o
    // container, É trabalho pendente, é literalmente o que o usuário estava
    // fazendo quando a sessão fechou.
    //
    // `dev.awaiting_gate` entrou porque o gate pode morrer (bug real
    // corrigido em paralelo, o 413 nas PRs) e deixar o dev agent preso
    // nesse estado indefinidamente — sem este sinal, o heartbeat fechava a
    // sessão por baixo e a aba Executores passava a mostrar "nenhuma
    // execução" com trabalho real pendurado.
    //
    // `dev.awaiting_approval` entrou pelo MESMO argumento, não por
    // segurança extra: o segundo sinal (ação `pending`) cobre a maior
    // parte da espera, mas não o intervalo inteiro. A decisão
    // (`approve`/`deny`) grava `proposed_actions.status` de forma
    // SÍNCRONA, na transação do `ApproveActionUseCase` — o segundo sinal
    // já não vê mais `pending` ali. A retomada do dev agent, porém, é
    // ASSÍNCRONA: só depois de `avisarQuemEsperava()` gravar
    // `task.action_settled`/`task.pr_settled` na outbox é que
    // `Engine.Outbox.Drain` (loop de polling) enfileira o job do Oban que
    // acorda `DevAgentServer` (`handle_info({:action_settled, ...})`).
    // Nessa janela — decisão já gravada, dev agent ainda não acordado — o
    // último evento `dev.*` continua sendo `dev.awaiting_approval`, e sem
    // este sinal a sessão fica sem NADA segurando ela: o mesmo defeito da
    // RN-411, um nível mais fundo.
    //
    // `dev.blocked_by_container` entrou pelo mesmo argumento (RN-502/ADR
    // 0143): o agente NÃO reivindicou task porque o projeto não tem container
    // `running` registrado, e quem sobe container é um HUMANO aprovando
    // `container_start`. Na execução real do `exp004` cinco agentes ficaram
    // assim e a sessão fechou 30s depois — eventos daquela sessão seguiram
    // chegando 13 e 32 minutos mais tarde, envenenando toda métrica por
    // sessão. O último evento VISÍVEL por agente era `dev.started`, que está
    // deliberadamente fora desta régua.
    //
    // `dev.idle` (sem tarefa nenhuma pra pegar, drenado de verdade) e os
    // demais tipos (`started`/`error`) ficam FORA desta régua.
    const devPendente = [...ultimoPorDevAgent.values()].find((e) =>
      DEV_PENDING_TYPES.has(e.type),
    );

    if (devPendente) {
      return {
        pending: true,
        motivo: `dev-agent ${devPendente.actor.id} com ${devPendente.type.replace('dev.', '')} (sem idle posterior)`,
        aguardandoUsuarioDesde: null,
      };
    }

    // QUINTO sinal (RN-581, AT-072): agente conversacional esperando o
    // USUÁRIO. No `exp001` o heartbeat fechou a sessão 30s depois de a aba
    // parar, com o Criativo tendo acabado de perguntar — nenhum dos quatro
    // sinais acima o via, porque um Criativo que terminou o turno está `idle`,
    // sem handoff, sem ação, sem `dev.*`. E a conversa seguiu escrevendo na
    // sessão morta por quatro minutos.
    //
    // O sinal: a fala mais recente da conversa é do AGENTE (resposta, pergunta
    // em formulário ou falha narrada) e o ator é um conversacional. Fala do
    // usuário por último não é espera pelo usuário — ou o agente está em
    // turno (terceiro sinal), ou não há ninguém esperando ninguém.
    //
    // É o ÚLTIMO sinal, e o único com TETO: os quatro de cima seguram a sessão
    // enquanto existirem; este a segura por até 8h (decisão do mantenedor,
    // 18/09), contadas do fim do turno. Por isso ele devolve o instante, e o
    // engine decide se estourou — e é por estar por último que um handoff
    // aberto numa conversa ociosa continua sem teto, como sempre foi.
    const ultimaFala = await this.sessionEvents.findLatestOfTypesInSession(
      sessionId,
      FIM_DE_TURNO,
    );
    if (
      ultimaFala &&
      TIPOS_DA_FALA_DO_AGENTE.has(ultimaFala.type) &&
      ultimaFala.actor.kind === 'agent' &&
      AGENTES_CONVERSACIONAIS.has(ultimaFala.actor.id)
    ) {
      const desde = ultimaFala.createdAt.toISOString();
      return {
        pending: true,
        motivo: `agente ${ultimaFala.actor.id} aguardando resposta do usuário desde ${desde} (${ultimaFala.type})`,
        aguardandoUsuarioDesde: desde,
      };
    }

    return NADA_PENDENTE;
  }
}

// Vocabulário emitido por `Engine.Dev.AgentIo`/`DevAgentServer`.
//
// Esta lista já se disse "completa, confirmada por leitura direta do código do
// engine" — e estava certa quando foi escrita. Foi essa afirmação que
// envelheceu: `dev.blocked_by_container` nasceu depois (RN-502/ADR 0143) e a
// lista não acompanhou, deixando o evento INVISÍVEL aqui — a api não o via nem
// para ignorá-lo. Numa execução real (`exp004`) cinco dev agents ficaram
// bloqueados por container e a sessão fechou 30 segundos depois; eventos
// daquela sessão continuaram chegando 13 e 32 minutos mais tarde.
//
// Quem mantém a afirmação verdadeira agora é MECANISMO, não disciplina:
// `scripts/ci/vocabulario-de-eventos-dev.spec.ts` extrai os tipos `dev.*` de
// `apps/engine/lib/**/*.ex` e reprova quando divergirem destas duas listas.
// Tipo novo no engine reprova o CI nomeando qual é.
const DEV_EVENT_TYPES = [
  'dev.started',
  'dev.working',
  'dev.awaiting_gate',
  'dev.awaiting_approval',
  'dev.idle',
  'dev.idle_tripped',
  'dev.blocked',
  'dev.blocked_by_container',
  'dev.error',
];

// `dev.blocked_by_container` é espera por AÇÃO HUMANA, como `dev.idle_tripped`
// e `dev.awaiting_approval`: o agente não reivindicou task nenhuma porque o
// projeto não tem container `running` registrado, e quem sobe container é uma
// pessoa aprovando `container_start` (ADR 0133/0137). Fechar a sessão por
// inatividade da aba enquanto isso está pendurado é o defeito que os outros
// quatro sinais já corrigiam.
const DEV_PENDING_TYPES = new Set([
  'dev.working',
  'dev.blocked',
  'dev.blocked_by_container',
  'dev.idle_tripped',
  'dev.awaiting_gate',
  'dev.awaiting_approval',
]);
