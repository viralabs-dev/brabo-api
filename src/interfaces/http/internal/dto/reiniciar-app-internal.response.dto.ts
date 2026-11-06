import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Resultado do reinício do processo do app (RN-1026, ADR 0264). Sem campo de
 * texto livre: o comando do app pode carregar segredo, então nenhum trecho de
 * log viaja.
 */
export class ReiniciarAppInternalResponseDto {
  @ApiProperty({ example: true })
  reiniciou!: boolean;

  @ApiPropertyOptional({
    enum: [
      'sem_container',
      'tempo_esgotado',
      'falha_no_exec',
      'app_saiu',
      'sem_app',
    ],
    description: 'Present only when `reiniciou: false`.',
  })
  motivo?:
    | 'sem_container'
    | 'tempo_esgotado'
    | 'falha_no_exec'
    | 'app_saiu'
    | 'sem_app';

  @ApiPropertyOptional({
    example: 1,
    description: 'Present only when `motivo: app_saiu`.',
  })
  exitCode?: number;
}
