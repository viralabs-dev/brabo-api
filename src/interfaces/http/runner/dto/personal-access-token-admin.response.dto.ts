import { ApiProperty } from '@nestjs/swagger';
import type { PatResumoComDono } from '../../../../application/ports/personal-access-token-repository.port';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import { PersonalAccessTokenResponseDto } from './personal-access-token.response.dto';

/**
 * A visão de `maintainer` (RN-427) — os mesmos campos de
 * `PersonalAccessTokenResponseDto`, mais o DONO do token. Nunca ganha
 * `token`/`tokenHash`, igual à base.
 */
export class PersonalAccessTokenAdminResponseDto
  extends PersonalAccessTokenResponseDto
  implements Wire<PatResumoComDono>
{
  @ApiProperty({ example: '01JC4Z0000USUARIO000000001' })
  userId!: string;

  @ApiProperty({ example: 'dev@exemplo.com' })
  userEmail!: string;
}
export const _chavesPersonalAccessTokenAdmin: MesmasChaves<
  PersonalAccessTokenAdminResponseDto,
  PatResumoComDono
> = true;
