import { Type } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsString,
  ValidateNested,
} from 'class-validator';
import type { ActorKind } from '../../../../domain/sessions/session-event.entity';

class ActorDto {
  @IsIn(['user', 'agent', 'system'])
  kind!: ActorKind;

  @IsString()
  @IsNotEmpty()
  id!: string;
}

export class AppendSessionEventDto {
  @IsString()
  @IsNotEmpty()
  type!: string;

  @ValidateNested()
  @Type(() => ActorDto)
  actor!: ActorDto;

  @IsObject()
  payload!: Record<string, unknown>;
}
