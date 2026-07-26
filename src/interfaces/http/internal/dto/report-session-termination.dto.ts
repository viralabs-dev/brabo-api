import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class ReportSessionTerminationDto {
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
  @IsIn(['closing', 'closed', 'closed_abnormally'])
  to!: 'closing' | 'closed' | 'closed_abnormally';

  @IsOptional()
  @IsString()
  reason?: string;
}
