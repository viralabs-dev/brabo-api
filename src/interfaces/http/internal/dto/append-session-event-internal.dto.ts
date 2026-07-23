import { IsIn, IsNotEmpty, IsObject, IsString, IsUUID } from 'class-validator';
import type { ActorKind } from '../../../../domain/sessions/session-event.entity';

export class AppendSessionEventInternalDto {
  @IsUUID()
  projectId!: string;

  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsIn(['user', 'agent', 'system'])
  actorKind!: ActorKind;

  @IsString()
  @IsNotEmpty()
  actorId!: string;

  @IsObject()
  payload!: Record<string, unknown>;
}
