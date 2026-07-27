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
      'Tipo da ação. Cada tipo tem papel mínimo próprio: `git_push`, `git_merge` e ' +
      '`git_branch_protect` exigem `maintainer`, o resto `developer`.',
  })
  @IsIn(ACTION_TYPES)
  actionType!: ActionType;

  @ApiProperty({ type: ActorDto, description: 'Quem está propondo.' })
  @ValidateNested()
  @Type(() => ActorDto)
  actor!: ActorDto;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { command: 'pnpm test' },
    description: 'Parâmetros da ação, com forma específica do `actionType`.',
  })
  @IsObject()
  payload!: Record<string, unknown>;
}
