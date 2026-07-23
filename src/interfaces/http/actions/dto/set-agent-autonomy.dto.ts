import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import {
  ACTION_TYPES,
  type ActionType,
} from '../../../../domain/actions/decide';
import type { PermissionPolicy } from '../../../../domain/actions/permissions-file';

export class SetAgentAutonomyDto {
  @IsString()
  @IsNotEmpty()
  agentId!: string;

  @IsIn(ACTION_TYPES)
  actionType!: ActionType;

  @IsIn(['auto_approve', 'require_approval', 'deny'])
  mode!: PermissionPolicy;
}
