import { Injectable } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { AgentAutonomyRepository } from '../../ports/agent-autonomy-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { UpsertAgentInstructionUseCase } from '../agents/upsert-agent-instruction.use-case';
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
  constructor(
    private readonly engineClient: ApiToEngineClient,
    private readonly moduleMaps: ModuleMapRepository,
    private readonly agentAutonomy: AgentAutonomyRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly upsertInstruction: UpsertAgentInstructionUseCase,
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
    return { ok: true as const };
  }
}
