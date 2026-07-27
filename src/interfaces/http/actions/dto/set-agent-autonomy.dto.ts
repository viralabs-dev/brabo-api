import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import {
  ACTION_TYPES,
  type ActionType,
} from '../../../../domain/actions/decide';
import type { PermissionPolicy } from '../../../../domain/actions/permissions-file';

export class SetAgentAutonomyDto {
  @ApiProperty({ example: 'dev-api', description: 'Slug do agente.' })
  @IsString()
  @IsNotEmpty()
  agentId!: string;

  @ApiProperty({ enum: ACTION_TYPES, example: 'terminal' })
  @IsIn(ACTION_TYPES)
  actionType!: ActionType;

  @ApiProperty({
    enum: ['auto_approve', 'require_approval', 'deny'],
    example: 'auto_approve',
    description:
      'Autonomia deste agente para este tipo. NÃO sobrepõe o `permissions.json`: ' +
      'um padrão em `deny` continua bloqueado por mais autonomia que o agente tenha.',
  })
  @IsIn(['auto_approve', 'require_approval', 'deny'])
  mode!: PermissionPolicy;
}
