import { IsIn, IsUUID } from 'class-validator';
import { ROLE_ORDER, type Role } from '../../../../domain/iam/role';

export class AddMemberDto {
  @IsUUID()
  userId!: string;

  @IsIn(ROLE_ORDER)
  role!: Role;
}
