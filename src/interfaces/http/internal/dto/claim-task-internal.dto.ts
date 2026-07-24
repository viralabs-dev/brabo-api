import { IsString, IsUUID } from 'class-validator';

// Chamada interna do engine (DevAgentServer pega a próxima task do módulo).
export class ClaimTaskInternalDto {
  @IsUUID()
  projectId!: string;

  @IsString()
  module!: string;

  @IsString()
  agentId!: string;
}
