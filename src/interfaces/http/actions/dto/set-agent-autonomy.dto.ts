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
  @ApiProperty({ example: 'dev-api', description: 'Agent slug.' })
  @IsString()
  @IsNotEmpty()
  agentId!: string;

  @ApiProperty({
    enum: AGENT_AUTONOMY_ACTION_TYPES,
    example: 'terminal',
    description:
      'Action type, or `"*"` for EVERY action type of this agent — the ' +
      '"auto mode" of the ApprovalCard (RN-153). A SPECIFIC rule always wins ' +
      'over the wildcard: recording `terminal: deny` with `"*": auto_approve` ' +
      'already on still denies terminal.',
  })
  @IsIn(AGENT_AUTONOMY_ACTION_TYPES)
  actionType!: AgentAutonomyActionType;

  @ApiProperty({
    enum: ['auto_approve', 'require_approval', 'deny'],
    example: 'auto_approve',
    description:
      "This agent's autonomy for this type. Does NOT override `permissions.json`: " +
      'a pattern in `deny` stays blocked no matter how much autonomy the agent has.',
  })
  @IsIn(['auto_approve', 'require_approval', 'deny'])
  mode!: PermissionPolicy;
}
