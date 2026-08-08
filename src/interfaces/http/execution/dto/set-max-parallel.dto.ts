import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class SetMaxParallelDto {
  @ApiProperty({
    example: 4,
    minimum: 1,
    description:
      'Quantos agentes o lead da área pode ter na sessão SEM pedir sua ' +
      'autorização. Mínimo 1 — zero não significa "sem limite", significa ' +
      'configuração inválida, e tratá-lo como ilimitado transformaria um erro ' +
      'de digitação em gasto irrestrito.',
  })
  @IsInt()
  @Min(1)
  maxParallel!: number;
}
