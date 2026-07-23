import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import type { ActorKind } from '../../../../domain/sessions/session-event.entity';

export class ActorDto {
  @IsIn(['user', 'agent', 'system'])
  kind!: ActorKind;

  @IsString()
  @IsNotEmpty()
  id!: string;
}
