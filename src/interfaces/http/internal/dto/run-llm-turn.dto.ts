import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';
import type { ChatMessage, ToolDef } from '@brabo/shared';

// Chamada interna do engine (cliente confiável, EngineServiceGuard) — a
// validação profunda de messages/tools fica leve de propósito; o RunLlmTurn
// os repassa pro provider.
export class RunLlmTurnDto {
  @IsUUID()
  projectId!: string;

  @IsOptional()
  @IsString()
  agentId?: string;

  @IsArray()
  messages!: ChatMessage[];

  @IsOptional()
  @IsArray()
  tools?: ToolDef[];
}
