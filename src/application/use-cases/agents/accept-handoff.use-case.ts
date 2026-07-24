import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HandoffRepository } from '../../ports/handoff-repository.port';
import { AgentAutonomyRepository } from '../../ports/agent-autonomy-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { ActivateAgentUseCase } from './activate-agent.use-case';

// InfraAgent NUNCA aplica nada em ambiente, só propõe (Fase 4a) — a PR de
// infra fica pending por padrão em decide() (open_infra_pr: 'maintainer'),
// mas essa autonomia seedada aqui deixa a PROPOSTA auto-aprovada pro
// InfraAgent especificamente (auto-aprovar a proposta de uma PR é seguro; a
// PR de verdade ainda precisa ser mergeada manualmente no provider). O
// terminal genérico fica negado por policy — defesa em profundidade além
// da estrutural (o tool registry do InfraAgent nunca inclui `Terminal`).
const INFRA_AUTONOMY_SEEDS: ReadonlyArray<{
  actionType: string;
  policy: 'auto_approve' | 'deny';
}> = [
  { actionType: 'open_infra_pr', policy: 'auto_approve' },
  { actionType: 'terminal', policy: 'deny' },
];

/**
 * O usuário aceita um handoff oferecido — transiciona offered→accepted, grava
 * `handoff.accepted` e ATIVA o agente destino (PO). A regra de ativação
 * (agent-activation) exige um handoff accepted endereçado ao agente — que
 * passa a existir exatamente por esta aceitação.
 */
@Injectable()
export class AcceptHandoffUseCase {
  constructor(
    private readonly handoffs: HandoffRepository,
    private readonly agentAutonomy: AgentAutonomyRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly activateAgent: ActivateAgentUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    handoffId: string,
    userId: string,
  ) {
    const handoff = await this.handoffs.findById(handoffId);
    if (!handoff || handoff.sessionId !== sessionId) {
      throw new NotFoundException('Handoff não encontrado');
    }
    if (handoff.status !== 'offered') {
      throw new BadRequestException(
        `Handoff não está "offered" (está "${handoff.status}")`,
      );
    }

    const accepted = await this.handoffs.updateStatus(handoffId, 'accepted');

    await this.appendEvent.execute(projectId, sessionId, {
      type: 'handoff.accepted',
      actor: { kind: 'user', id: userId },
      payload: { handoffId, toAgent: handoff.toAgent },
    });

    if (handoff.toAgent === 'infra') {
      for (const seed of INFRA_AUTONOMY_SEEDS) {
        await this.agentAutonomy.upsert(
          projectId,
          'infra',
          seed.actionType,
          seed.policy,
        );
      }
    }

    // Agora a regra de ativação passa (handoff accepted p/ toAgent).
    await this.activateAgent.execute(
      projectId,
      sessionId,
      handoff.toAgent,
      userId,
    );

    return accepted;
  }
}
