import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';
import { ROLE_ORDER, type Role } from '../../../../domain/iam/role';

export class AddMemberDto {
  @ApiProperty({
    format: 'uuid',
    example: '3f1b2c8e-5a4d-4b7e-9c10-2d6f8a1b4c33',
    description: 'Id do usuário a associar.',
  })
  @IsUUID()
  userId!: string;

  @ApiProperty({
    enum: ROLE_ORDER,
    example: 'developer',
    description:
      'Papel nesta associação. O papel EFETIVO de alguém num projeto é o maior ' +
      'entre este e o que ele tem no workspace.',
  })
  @IsIn(ROLE_ORDER)
  role!: Role;
}
