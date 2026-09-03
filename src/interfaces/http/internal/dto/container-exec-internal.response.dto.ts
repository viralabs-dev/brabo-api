import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Resultado de rodar um comando DENTRO do container real do projeto (ADR
 * 0134, RN-492). `sucesso: false` é a forma NORMAL de "o broker recusou ou
 * não respondeu" — nunca um erro HTTP: o broker pode ter morrido ou sido
 * removido por fora entre o registro `running` e esta chamada (RN-486), e
 * isso é uma falha de COMANDO, não do transporte.
 */
export class ContainerExecInternalResponseDto {
  @ApiProperty({
    example: true,
    description:
      '`false` quando o broker recusou ou não respondeu — os outros campos ' +
      'ficam ausentes e `motivo` explica.',
  })
  sucesso!: boolean;

  @ApiPropertyOptional({
    example: 0,
    description: 'Presente só quando `sucesso: true`.',
  })
  exitCode?: number;

  @ApiPropertyOptional({
    example: 'ok\n',
    description: 'Presente só quando `sucesso: true`.',
  })
  output?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Presente só quando `sucesso: true`.',
  })
  timedOut?: boolean;

  @ApiPropertyOptional({
    example:
      'o broker de container não respondeu em http://broker:8090: timeout',
    description: 'Presente só quando `sucesso: false`.',
  })
  motivo?: string;
}
