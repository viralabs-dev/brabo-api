import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, Min } from 'class-validator';
import { BUDGET_POLICIES } from '../../../../domain/llm/budget-threshold';
import type { BudgetPolicy } from '../../../../domain/llm/budget-threshold';

export class UpsertBudgetDto {
  @ApiProperty({
    example: 50,
    minimum: 0,
    description:
      'Teto em DÓLARES — é o único lugar do contrato que fala em dólar, porque é o ' +
      'que uma pessoa digita. A api converte para micro-USD, e as respostas voltam ' +
      'em micro-USD.',
  })
  @IsNumber()
  @Min(0)
  limitUsd!: number;

  @ApiProperty({
    enum: BUDGET_POLICIES,
    example: 'block',
    description:
      '`block` recusa a chamada ao estourar o teto; `allow` deixa passar e apenas ' +
      'avisa.',
  })
  @IsIn(['block', 'allow'])
  policy!: BudgetPolicy;
}
