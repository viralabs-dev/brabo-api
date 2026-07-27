import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class ReportSessionTerminationDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  /**
   * `closing` entrou na Fase 5 para o drain de shutdown do engine.
   *
   * Não é um estado terminal: significa "estou soltando esta sessão com esta
   * causa". O drain marca `closing` + `node_shutdown` e depois decide — se
   * outra réplica adotar a sessão, ela segue viva; se ninguém adotar até o
   * timeout, o próprio drain manda `closed_abnormally`.
   *
   * `created` e `active` continuam fora: entrar nesses estados é decisão da
   * api (ou do usuário), nunca do engine relatando um término.
   */
  @ApiProperty({
    enum: ['closing', 'closed', 'closed_abnormally'],
    example: 'closed_abnormally',
    description:
      '`closing` NÃO é terminal: significa "estou soltando esta sessão". Se outra réplica adotá-la ela segue viva; se ninguém adotar até o timeout, o drain manda `closed_abnormally`. `created` e `active` ficam de fora porque entrar neles é decisão da api, nunca do engine relatando término.',
  })
  @IsIn(['closing', 'closed', 'closed_abnormally'])
  to!: 'closing' | 'closed' | 'closed_abnormally';

  @ApiPropertyOptional({
    example: 'heartbeat_timeout',
    description: 'A ORIGEM do término, não um diagnóstico por eliminação.',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
