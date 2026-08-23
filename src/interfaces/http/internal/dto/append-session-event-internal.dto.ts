import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsObject, IsString, IsUUID } from 'class-validator';
import type { ActorKind } from '../../../../domain/sessions/session-event.entity';

export class AppendSessionEventInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({
    example: 'agent.tool_call',
    description: 'See `docs/reference/events.md`.',
  })
  @IsString()
  @IsNotEmpty()
  type!: string;

  @ApiProperty({ enum: ['user', 'agent', 'system'], example: 'agent' })
  @IsIn(['user', 'agent', 'system'])
  actorKind!: ActorKind;

  @ApiProperty({
    example: 'dev-api',
    description: 'Slug of the agent that emitted it.',
  })
  @IsString()
  @IsNotEmpty()
  actorId!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { tool: 'ler_arquivo' },
  })
  @IsObject()
  payload!: Record<string, unknown>;
}
