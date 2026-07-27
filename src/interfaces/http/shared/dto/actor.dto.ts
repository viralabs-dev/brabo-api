import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import type { ActorKind } from '../../../../domain/sessions/session-event.entity';

export class ActorDto {
  @ApiProperty({
    enum: ['user', 'agent', 'system'],
    example: 'agent',
    description: 'Natureza de quem agiu.',
  })
  @IsIn(['user', 'agent', 'system'])
  kind!: ActorKind;

  @ApiProperty({
    example: 'dev-api',
    description:
      'Id do usuário quando `kind=user`; o slug do agente quando `kind=agent`.',
  })
  @IsString()
  @IsNotEmpty()
  id!: string;
}
