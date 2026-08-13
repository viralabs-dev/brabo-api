import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import {
  ACTION_TYPES,
  AGENT_AUTONOMY_ALL_ACTIONS,
  type AgentAutonomyActionType,
} from '../../../../domain/actions/decide';
import type { PermissionPolicy } from '../../../../domain/actions/permissions-file';

const AGENT_AUTONOMY_ACTION_TYPES = [
  ...ACTION_TYPES,
  AGENT_AUTONOMY_ALL_ACTIONS,
];

export class SetAgentAutonomyDto {
  @ApiProperty({ example: 'dev-api', description: 'Slug do agente.' })
  @IsString()
  @IsNotEmpty()
  agentId!: string;

  @ApiProperty({
    enum: AGENT_AUTONOMY_ACTION_TYPES,
    example: 'terminal',
    description:
      'Tipo de ação, ou `"*"` para TODO tipo de ação deste agente — o "auto ' +
      'mode" do ApprovalCard (RN-153). Uma regra ESPECÍFICA sempre vence a ' +
      'curinga: gravar `terminal: deny` com `"*": auto_approve` já ligado ' +
      'continua negando terminal.',
  })
  @IsIn(AGENT_AUTONOMY_ACTION_TYPES)
  actionType!: AgentAutonomyActionType;

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
