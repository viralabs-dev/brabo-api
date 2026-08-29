import { ApiProperty } from '@nestjs/swagger';

/**
 * Resposta do registro de uma chave de dispositivo — de propósito mais
 * enxuta que `ChaveDeDispositivoResumo` (não usa `Wire`/`MesmasChaves`,
 * diferente de `PersonalAccessTokenResponseDto`): não há motivo pro
 * navegador, que acabou de gerar e já tem a própria JWK pública, receber
 * de volta `projectId`/`revokedAt`/`lastUsedAt` de uma chave recém-criada.
 */
export class RunnerDeviceKeyResponseDto {
  @ApiProperty({ example: '01JC4Z0000CHAVE000000000001' })
  id!: string;

  @ApiProperty({ example: 'laptop' })
  name!: string;

  @ApiProperty({ example: '2026-08-27T12:00:00.000Z', format: 'date-time' })
  createdAt!: string;
}
