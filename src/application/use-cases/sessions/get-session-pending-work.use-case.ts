import { Injectable } from '@nestjs/common';
import { HandoffRepository } from '../../ports/handoff-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';

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
    // ([RN-073](../../../../docs/business-rules.md#rn-073)).
    const acao =
      await this.proposedActions.findOldestPendingInSession(sessionId);

    if (acao) {
      return {
        pending: true,
        motivo: `ação ${acao.actionType} de ${acao.actor?.id ?? 'um agente'} aguardando decisão`,
      };
    }

    return { pending: false, motivo: null };
  }
}
