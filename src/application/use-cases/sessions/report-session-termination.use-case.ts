import { Injectable } from '@nestjs/common';
import { SessionRepository } from '../../ports/session-repository.port';
import { TransitionSessionUseCase } from './transition-session.use-case';
import type { SessionStatus } from '../../../domain/sessions/session-state-machine';

/**
 * Reportado pelo engine quando um processo de sessão supervisionado
 * termina. `to` é decidido pelo engine (heartbeat_timeout -> "closed",
 * crash/kill/normal defensivo -> "closed_abnormally").
 *
 * ALLOWED_TRANSITIONS['active'] só permite ['closing', 'closed_abnormally']
 * — não 'closed' direto — então, quando o destino é 'closed' e a sessão
 * ainda está 'active', fazemos o hop implícito active->closing aqui,
 * cirurgicamente, sem tocar em ALLOWED_TRANSITIONS/TransitionSessionUseCase
 * (que continuam servindo o resto do sistema sem mudança de comportamento
 * pra outros chamadores, ex. a rota humana de transição).
 *
 * `closing` passou a ser um destino ACEITÁVEL vindo do engine (Fase 5): o
 * drain de shutdown marca as sessões que está largando com causa
 * `node_shutdown` antes de decidir se elas serão adotadas por outra réplica ou
 * encerradas. Sem isso o engine não tinha como anunciar "estou soltando esta
 * sessão" — a única rota que aceitava `closing` era a humana, atrás de
 * RBAC de usuário, inacessível ao client `engine-service`.
 */
@Injectable()
export class ReportSessionTerminationUseCase {
  constructor(
    private readonly transitionSession: TransitionSessionUseCase,
    private readonly sessions: SessionRepository,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    to: Extract<SessionStatus, 'closing' | 'closed' | 'closed_abnormally'>,
    reason?: string,
  ) {
    if (to === 'closed') {
      const current = await this.sessions.findInProject(projectId, sessionId);
      if (current?.status === 'active') {
        await this.transitionSession.execute(projectId, sessionId, 'closing');
      }
    }

    return this.transitionSession.execute(projectId, sessionId, to, reason);
  }
}
