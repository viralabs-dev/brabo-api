import { Injectable } from '@nestjs/common';
import { HandoffRepository } from '../../ports/handoff-repository.port';

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
  constructor(private readonly handoffs: HandoffRepository) {}

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

    // Task em andamento NÃO entra ainda: o dev agent tem máquina de estados
    // própria (Fase 12b) e retém o worktree por conta dele; incluí-la aqui sem
    // um teste que prove a interação seria adivinhar. Handoff pendurado é o
    // caso que a execução real produziu, e é o que esta versão fecha.
    return { pending: false, motivo: null };
  }
}
