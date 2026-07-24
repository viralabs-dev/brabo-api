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
  @IsIn(['user', 'agent', 'system'])
  kind!: ActorKind;

  @IsString()
  @IsNotEmpty()
  id!: string;
}

// Criação de proposed_action pelo engine (ToolLoop) via endpoint interno —
// mesma decisão (decide/permissions) da rota humana, só que o ator é o
// agente e a autenticação é client-credentials (EngineServiceGuard).
export class CreateActionInternalDto {
  @IsUUID()
  projectId!: string;

  @IsIn(ACTION_TYPES as readonly string[])
  actionType!: string;

  @ValidateNested()
  @Type(() => ActorDto)
  actor!: ActorDto;

  @IsObject()
  payload!: Record<string, unknown>;
}
