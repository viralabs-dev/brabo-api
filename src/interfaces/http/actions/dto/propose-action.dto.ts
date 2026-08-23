import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsObject, ValidateNested } from 'class-validator';
import { ActorDto } from '../../shared/dto/actor.dto';
import {
  ACTION_TYPES,
  type ActionType,
} from '../../../../domain/actions/decide';

export class ProposeActionDto {
  @ApiProperty({
    enum: ACTION_TYPES,
    example: 'terminal',
    description:
      'Action type. Each type has its own minimum role: `git_push`, `git_merge`, ' +
      'and `git_branch_protect` require `maintainer`, the rest `developer`.',
  })
  @IsIn(ACTION_TYPES)
  actionType!: ActionType;

  @ApiProperty({ type: ActorDto, description: 'Who is proposing it.' })
  @ValidateNested()
  @Type(() => ActorDto)
  actor!: ActorDto;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { command: 'pnpm test' },
    description: 'Action parameters, with a shape specific to the `actionType`.',
  })
  @IsObject()
  payload!: Record<string, unknown>;
}
