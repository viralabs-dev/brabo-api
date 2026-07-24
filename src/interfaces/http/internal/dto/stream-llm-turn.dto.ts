import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';
import type { ChatMessage, ToolDef } from '@brabo/shared';

// Igual ao RunLlmTurnDto, mas o endpoint responde em SSE (streamado). Chamada
// interna do engine (EngineServiceGuard) — validação leve de propósito.
export class StreamLlmTurnDto {
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
