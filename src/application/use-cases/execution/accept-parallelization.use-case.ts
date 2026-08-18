import { Injectable, Logger } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { AgentAutonomyRepository } from '../../ports/agent-autonomy-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { UpsertAgentInstructionUseCase } from '../agents/upsert-agent-instruction.use-case';
import { RecordDelegationUseCase } from './record-delegation.use-case';
import {
  DEV_AUTO_GIT_ACTIONS,
  devAgentInstruction,
  extraDevAgentId,
} from './activate-execution.use-case';

/**
 * Aceite (um clique) da sugestão de paralelização: sobe um dev extra
 * (`dev-<modulo>-2`) no mesmo módulo, com worktree próprio. Ação do usuário.
 */
@Injectable()
export class AcceptParallelizationUseCase {
  private readonly logger = new Logger(AcceptParallelizationUseCase.name);

  constructor(
    private readonly engineClient: ApiToEngineClient,
    private readonly moduleMaps: ModuleMapRepository,
    private readonly agentAutonomy: AgentAutonomyRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly upsertInstruction: UpsertAgentInstructionUseCase,
    private readonly sessionEvents: SessionEventRepository,
    private readonly recordDelegation: RecordDelegationUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    module: string,
    userId: string,
  ) {
    // O subagente extra precisa das MESMAS instruções e da MESMA autonomia do
    // agente base ANTES de existir: sem linha em agent_autonomy, decide() cai
    // no default `require_approval` e tudo que ele propõe (git_commit/
    // git_push/pr_open) fica pendente — um "aceite de um clique" que na
    // prática pede três aprovações manuais por task. `git_merge` continua de
    // fora: a trava de merge o mantém manual.
    const agentId = extraDevAgentId(module);
    const moduleMap = await this.moduleMaps.findCurrent(projectId);
    const node = moduleMap?.modules.find((m) => m.name === module);
    if (node) {
      await this.upsertInstruction.execute(
        projectId,
        agentId,
        devAgentInstruction(agentId, node),
      );
    }
    for (const type of DEV_AUTO_GIT_ACTIONS) {
      await this.agentAutonomy.upsert(projectId, agentId, type, 'auto_approve');
    }

    // O engine vem PRIMEIRO: ele recusa (409) quando não há agente base de
    // quem herdar o teto de tokens, e o event log é imutável — registrar o
    // aceite antes deixaria no feed um "paralelização aceita" que nunca
    // aconteceu, sem como retratar.
    await this.engineClient.acceptParallelization(projectId, sessionId, module);
    await this.appendEvent.execute(projectId, sessionId, {
      type: 'execution.parallelization_accepted',
      actor: { kind: 'user', id: userId },
      payload: { module, agentId },
    });

    // Auditoria fluxo.yml x código (item B1, ADR 0094): a delegação
    // Dev Lead → dev-<modulo> vira DADO em `delegations`, com `area: 'dev'`
    // — mesmo padrão de QA e Infra (ADR 0038), com UMA diferença consciente:
    // `status: 'completed'` aqui significa "a delegação foi EFETIVADA" (o
    // agente subiu), não "o subagente terminou e emitiu parecer". Não pode
    // travar a ativação, que já é sucesso — falha ou lacuna vira LOG, nunca
    // exceção (RN-059: nunca falha silenciosa, mas também nunca aborta um
    // sucesso já consumado).
    await this.recordDevDelegation(projectId, sessionId, module, agentId);

    return { ok: true as const };
  }

  private async recordDevDelegation(
    projectId: string,
    sessionId: string,
    module: string,
    agentId: string,
  ): Promise<void> {
    const moduleMapEvents = await this.sessionEvents.listByTypeForProject(
      projectId,
      'artifact.module_map',
    );
    const latestModuleMapEvent = moduleMapEvents.at(-1);

    if (!latestModuleMapEvent) {
      // Não deveria acontecer — o Arquiteto sempre entrega module_map antes
      // do Dev Lead operar (entrada obrigatória dele em docs/fluxo.yml).
      // Mas se acontecer, a delegação NÃO nasce com um id falso: pula, e diz
      // por quê, em vez de mentir sobre o que justificou a decisão.
      this.logger.error(
        `Delegação dev-lead → ${agentId} (área dev, módulo "${module}") NÃO ` +
          `registrada: nenhum artifact.module_map encontrado no projeto ` +
          `${projectId}. O dev agent já foi ativado; só a gravação da ` +
          `delegação foi pulada.`,
      );
      return;
    }

    try {
      await this.recordDelegation.execute(projectId, sessionId, {
        area: 'dev',
        leadAgent: 'dev-lead',
        subagent: agentId,
        status: 'completed',
        parecerArtifactId: latestModuleMapEvent.id,
      });
    } catch (error) {
      this.logger.error(
        `Falha ao registrar delegação dev-lead → ${agentId} (área dev, ` +
          `módulo "${module}"): ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
