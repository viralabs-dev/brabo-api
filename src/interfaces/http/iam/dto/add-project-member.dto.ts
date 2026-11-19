import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { ROLE_ORDER, type Role } from '../../../../domain/iam/role';

/**
 * Convite de membro do PROJETO: `email` (de alguém do workspace, AT-974) ou
 * `userId`. Um dos dois é obrigatório; `email` vence quando vêm os dois. O
 * papel segue a descrição do `AddMemberDto`.
 */
export class AddProjectMemberDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Id of the user. Required when `email` is absent.',
  })
  @ValidateIf((o: AddProjectMemberDto) => !o.email)
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    format: 'email',
    description:
      'E-mail of a workspace user. Answers 404 when nobody in the workspace has it.',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    enum: ROLE_ORDER,
    example: 'developer',
    description:
      'Role in this association; it OVERRIDES the workspace role (see ' +
      'the operation description for the two refused movements).',
  })
  @IsIn(ROLE_ORDER)
  role!: Role;
}
