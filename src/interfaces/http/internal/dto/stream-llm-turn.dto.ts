import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';
import type { ChatMessage, ToolDef } from '@brabo/shared';

// Igual ao RunLlmTurnDto, mas o endpoint responde em SSE (streamado). Chamada
// interna do engine (EngineServiceGuard) — validação leve de propósito.
export class StreamLlmTurnDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiPropertyOptional({ example: 'criativo' })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    example: [{ role: 'user', content: 'Summarize what we decided.' }],
  })
  @IsArray()
  messages!: ChatMessage[];

  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  @IsOptional()
  @IsArray()
  tools?: ToolDef[];
}
