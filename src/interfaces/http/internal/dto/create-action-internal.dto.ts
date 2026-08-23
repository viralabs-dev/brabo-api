import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ACTION_TYPES } from '../../../../domain/actions/decide';
import type { ActorKind } from '../../../../domain/sessions/session-event.entity';

class ActorDto {
  @ApiProperty({ enum: ['user', 'agent', 'system'], example: 'agent' })
  @IsIn(['user', 'agent', 'system'])
  kind!: ActorKind;

  @ApiProperty({ example: 'dev-api' })
  @IsString()
  @IsNotEmpty()
  id!: string;
}

// Criação de proposed_action pelo engine (ToolLoop) via endpoint interno —
// mesma decisão (decide/permissions) da rota humana, só que o ator é o
// agente e a autenticação é client-credentials (EngineServiceGuard).
export class CreateActionInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ enum: ACTION_TYPES, example: 'terminal' })
  @IsIn(ACTION_TYPES as readonly string[])
  actionType!: string;

  @ApiProperty({
    type: ActorDto,
    description: 'Always an agent on this route.',
  })
  @ValidateNested()
  @Type(() => ActorDto)
  actor!: ActorDto;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { command: 'pnpm test' },
  })
  @IsObject()
  payload!: Record<string, unknown>;
}
