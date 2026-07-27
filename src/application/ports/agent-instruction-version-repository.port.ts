import type { AgentInstructionVersion } from '../../domain/instructions/agent-instruction-version.entity';

export interface NewAgentInstructionVersion {
  projectId: string;
  agent: string;
  version: number;
  content: string;
  createdBy?: string | null;
  sourceActionId?: string | null;
  sourceHypothesisId?: string | null;
  note?: string | null;
}

export abstract class AgentInstructionVersionRepository {
  abstract create(
    input: NewAgentInstructionVersion,
  ): Promise<AgentInstructionVersion>;
  /**
   * Agentes do projeto que TÊM histórico de instrução.
   *
   * A UI listava o histórico fazendo fan-out sobre o roster estático
   * (`AGENT_LIST`), que tem `dev-backend`/`dev-frontend` — mas a Fase 4a
   * instancia um dev agent POR MÓDULO (`dev-api`, `dev-web`, ...). Resultado:
   * o histórico e o rollback eram invisíveis exatamente pros agentes que
   * existem num projeto real, que são os que a Anamnese mais patcheia.
   */
  abstract listAgentsWithHistory(projectId: string): Promise<string[]>;
  // Histórico completo de um agente, mais recente primeiro.
  abstract listByAgent(
    projectId: string,
    agent: string,
  ): Promise<AgentInstructionVersion[]>;
  abstract findVersion(
    projectId: string,
    agent: string,
    version: number,
  ): Promise<AgentInstructionVersion | null>;
}
