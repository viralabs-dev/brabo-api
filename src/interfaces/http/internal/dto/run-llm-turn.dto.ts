import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';
import type { ChatMessage, ToolDef } from '@brabo/shared';

// Chamada interna do engine (cliente confiável, EngineServiceGuard) — a
// validação profunda de messages/tools fica leve de propósito; o RunLlmTurn
// os repassa pro provider.
export class RunLlmTurnDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiPropertyOptional({
    example: 'dev-api',
    description: 'Atribui o custo a este agente no painel do time.',
  })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    example: [{ role: 'user', content: 'Leia o arquivo X.' }],
    description: 'Histórico já montado pelo ContextManager do engine.',
  })
  @IsArray()
  messages!: ChatMessage[];

  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'Ferramentas oferecidas ao modelo; `parameters` é JSON Schema.',
  })
  @IsOptional()
  @IsArray()
  tools?: ToolDef[];
}
