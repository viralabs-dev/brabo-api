import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import type { PermissionPolicy } from '../../../../domain/actions/permission-resolver';

class PermissionRuleDto {
  @IsString()
  @IsNotEmpty()
  actionType!: string;

  @IsIn(['auto_approve', 'require_approval', 'deny'])
  policy!: PermissionPolicy;
}

export class SetProjectPermissionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionRuleDto)
  rules!: PermissionRuleDto[];
}
