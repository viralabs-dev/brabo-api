import { ApiProperty } from '@nestjs/swagger';
import type { PatResumo } from '../../../../application/ports/personal-access-token-repository.port';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';

/** Nunca ganha `token`/`tokenHash` — é o formato de LISTA. */
export class PersonalAccessTokenResponseDto implements Wire<PatResumo> {
  @ApiProperty({ example: '01JC4Z0000PAT000000000001' })
  id!: string;

  @ApiProperty({ example: 'laptop' })
  name!: string;

  @ApiProperty({ example: '01JC4Z0000PROJETO000000001' })
  projectId!: string;

  @ApiProperty({ example: '2026-08-22T12:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'Nulo = sem expiração.',
  })
  expiresAt!: string | null;

  @ApiProperty({ example: null, nullable: true })
  revokedAt!: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'Nulo = nunca usado.',
  })
  lastUsedAt!: string | null;
}
export const _chavesPersonalAccessToken: MesmasChaves<
  PersonalAccessTokenResponseDto,
  PatResumo
> = true;
