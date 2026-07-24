export interface AgentInstruction {
  id: string;
  projectId: string;
  agent: string;
  content: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export abstract class AgentInstructionRepository {
  abstract findByProjectAndAgent(
    projectId: string,
    agent: string,
  ): Promise<AgentInstruction | null>;

  // Idempotente por (projectId, agent). Insere se não existe; se existe e o
  // conteúdo mudou, atualiza e bumpa a version; se o conteúdo é idêntico, não
  // toca (retorna a linha atual). O engine só LÊ esta tabela.
  abstract upsert(input: {
    projectId: string;
    agent: string;
    content: string;
  }): Promise<AgentInstruction>;
}
