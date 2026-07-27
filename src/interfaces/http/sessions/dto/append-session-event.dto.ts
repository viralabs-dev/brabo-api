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
      'Tipo do evento. O inventário completo está em `docs/reference/events.md`.',
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
    example: { role: 'user', content: 'Quero um checkout novo.' },
    description: 'Forma livre, específica de cada `type`.',
  })
  @IsObject()
  payload!: Record<string, unknown>;
}
