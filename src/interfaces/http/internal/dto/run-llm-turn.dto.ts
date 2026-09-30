import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
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
    description: 'Attributes the cost to this agent in the team panel.',
  })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    example: [{ role: 'user', content: 'Read file X.' }],
    description: "History already assembled by the engine's ContextManager.",
  })
  @IsArray()
  messages!: ChatMessage[];

  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Tools offered to the model; `parameters` is JSON Schema.',
  })
  @IsOptional()
  @IsArray()
  tools?: ToolDef[];

  @ApiPropertyOptional({
    example: true,
    description:
      'Asks for the WHOLE tool catalog: the Jev tool router (ADR 0179) is ' +
      'skipped for this call. The engine sets it when it repeats a step whose ' +
      'restricted menu made the model answer without calling a tool.',
  })
  @IsOptional()
  @IsBoolean()
  catalogoCompleto?: boolean;
}
