import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import type { ActorKind } from '../../../../domain/sessions/session-event.entity';

export class ActorDto {
  @ApiProperty({
    enum: ['user', 'agent', 'system'],
    example: 'agent',
    description: 'Nature of who acted.',
  })
  @IsIn(['user', 'agent', 'system'])
  kind!: ActorKind;

  @ApiProperty({
    example: 'dev-api',
    description:
      "The user's id when `kind=user`; the agent's slug when `kind=agent`.",
  })
  @IsString()
  @IsNotEmpty()
  id!: string;
}
