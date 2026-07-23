import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsObject,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ActorDto } from '../../shared/dto/actor.dto';

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
