import { Injectable } from '@nestjs/common';
import { AgentInstructionRepository } from '../../ports/agent-instruction-repository.port';

/**
 * Upsert idempotente das instruções base (persona) de um agente num projeto.
 * Usado pelo seed versionado do Criativo — a version só é bumpada quando o
 * conteúdo muda (ver DrizzleAgentInstructionRepository.upsert). O engine só
 * LÊ estas instruções (InstructionFiles) pra montar o system prompt.
 */
@Injectable()
export class UpsertAgentInstructionUseCase {
  constructor(private readonly instructions: AgentInstructionRepository) {}

  execute(projectId: string, agent: string, content: string) {
    return this.instructions.upsert({ projectId, agent, content });
  }
}
