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
