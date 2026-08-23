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
      '`closing` is NOT terminal: it means "I am releasing this session". If another replica adopts it, it stays alive; if no one adopts it before the timeout, the drain sends `closed_abnormally`. `created` and `active` are left out because entering them is a decision made by the api, never by the engine reporting a termination.',
  })
  @IsIn(['closing', 'closed', 'closed_abnormally'])
  to!: 'closing' | 'closed' | 'closed_abnormally';

  @ApiPropertyOptional({
    example: 'heartbeat_timeout',
    description:
      'The ORIGIN of the termination, not a diagnosis by elimination.',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
