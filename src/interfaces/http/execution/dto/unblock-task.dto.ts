import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export const TETO_DA_ORIENTACAO = 2000;

/** Corpo opcional do "Desbloquear" (RN-1124). */
export class UnblockTaskDto {
  @ApiPropertyOptional({
    example: 'The module is composed by another one: do not boot it alone.',
    maxLength: TETO_DA_ORIENTACAO,
    description:
      'Guidance for the dev that takes the task back. It reaches the dev in ' +
      'the task context and wins over the last gate report.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(TETO_DA_ORIENTACAO)
  orientacao?: string;
}
