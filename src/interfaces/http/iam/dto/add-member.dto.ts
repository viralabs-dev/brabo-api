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

  // Este DTO serve às DUAS rotas de associação — `POST projects/:id/members` e
  // `POST workspaces/:id/members` —, então a descrição diz de qual das duas
  // está falando. A redação anterior ("the EFFECTIVE role is the higher of
  // this one and what they have in the workspace") era falsa nas duas: no
  // projeto porque a sobreposição vale para baixo também (RN-471), e no
  // workspace porque não há nada acima para comparar. A frase seguinte ("a
  // rota de workspace segue sem teto nenhum") era verdadeira até o ADR 0157
  // (RN-557), que pôs ali o teto de auto-movimento — e alargou o do projeto
  // para cobrir também a auto-PROMOÇÃO. O teto do `owner` do workspace segue
  // sendo só do projeto (ADR 0127, RN-472), por ser regra sobre inversão de
  // hierarquia, que o `@RequireRole('owner')` da outra rota já impede.
  @ApiProperty({
    enum: ROLE_ORDER,
    example: 'developer',
    description:
      'Role in this association. On a PROJECT it OVERRIDES the workspace ' +
      'role in both directions — the effective role is this one whenever the ' +
      'association exists, higher OR lower — and two movements are refused ' +
      'with 403: downgrading a workspace `owner`, and changing your own role ' +
      '(either way). On a WORKSPACE it is simply the role, with only the ' +
      'second of those caps: you cannot change your own.',
  })
  @IsIn(ROLE_ORDER)
  role!: Role;
}
