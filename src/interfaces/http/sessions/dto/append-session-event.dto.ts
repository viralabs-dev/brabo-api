import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsObject,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ActorDto } from '../../shared/dto/actor.dto';

export class AppendSessionEventDto {
  @ApiProperty({
    example: 'chat.message',
    description:
      'Event type. The full inventory is in `docs/reference/events.md`.',
  })
  @IsString()
  @IsNotEmpty()
  type!: string;

  @ApiProperty({ type: ActorDto })
  @ValidateNested()
  @Type(() => ActorDto)
  actor!: ActorDto;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { role: 'user', content: 'I want a new checkout.' },
    description: 'Free-form shape, specific to each `type`.',
  })
  @IsObject()
  payload!: Record<string, unknown>;
}
