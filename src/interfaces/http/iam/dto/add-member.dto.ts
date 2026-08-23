import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';
import { ROLE_ORDER, type Role } from '../../../../domain/iam/role';

export class AddMemberDto {
  @ApiProperty({
    format: 'uuid',
    example: '3f1b2c8e-5a4d-4b7e-9c10-2d6f8a1b4c33',
    description: 'Id of the user to associate.',
  })
  @IsUUID()
  userId!: string;

  @ApiProperty({
    enum: ROLE_ORDER,
    example: 'developer',
    description:
      "Role in this association. Someone's EFFECTIVE role in a project is " +
      'the higher of this one and what they have in the workspace.',
  })
  @IsIn(ROLE_ORDER)
  role!: Role;
}
