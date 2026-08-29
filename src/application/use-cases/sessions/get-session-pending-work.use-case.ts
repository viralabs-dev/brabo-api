import { Injectable } from '@nestjs/common';
import { HandoffRepository } from '../../ports/handoff-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';

export interface SessionPendingWork {
  pending: boolean;
  /** O que está pendurado, para o log do engine dizer por que não fechou. */
  motivo: string | null;
}

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

    // Estes cinco significam "tem trabalho rolando ou um humano precisa
    // agir" — travado esperando desbloqueio, esperando o gate de QA/SecOps
    // terminar, ou esperando decisão de aprovação, É trabalho pendente, é
    // literalmente o que o usuário estava fazendo quando a sessão fechou.
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
    // `dev.idle` (sem tarefa nenhuma pra pegar, drenado de verdade) e os
    // demais tipos (`started`/`error`) ficam FORA desta régua.
    const devPendente = [...ultimoPorDevAgent.values()].find((e) =>
      DEV_PENDING_TYPES.has(e.type),
    );

    if (devPendente) {
      return {
        pending: true,
        motivo: `dev-agent ${devPendente.actor.id} com ${devPendente.type.replace('dev.', '')} (sem idle posterior)`,
      };
    }

    return { pending: false, motivo: null };
  }
}

// Vocabulário completo emitido por `Engine.Dev.AgentIo`/`DevAgentServer` —
// confirmado por leitura direta do código do engine, não por suposição.
const DEV_EVENT_TYPES = [
  'dev.started',
  'dev.working',
  'dev.awaiting_gate',
  'dev.awaiting_approval',
  'dev.idle',
  'dev.idle_tripped',
  'dev.blocked',
  'dev.error',
];

const DEV_PENDING_TYPES = new Set([
  'dev.working',
  'dev.blocked',
  'dev.idle_tripped',
  'dev.awaiting_gate',
  'dev.awaiting_approval',
]);
