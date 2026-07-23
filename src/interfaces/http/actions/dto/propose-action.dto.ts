import { Type } from 'class-transformer';
import { IsIn, IsObject, ValidateNested } from 'class-validator';
import { ActorDto } from '../../shared/dto/actor.dto';
import {
  ACTION_TYPES,
  type ActionType,
} from '../../../../domain/actions/decide';

export class ProposeActionDto {
  @IsIn(ACTION_TYPES)
  actionType!: ActionType;

  @ValidateNested()
  @Type(() => ActorDto)
  actor!: ActorDto;

  @IsObject()
  payload!: Record<string, unknown>;
}
