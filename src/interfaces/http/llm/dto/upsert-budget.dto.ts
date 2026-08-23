import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, Min } from 'class-validator';
import { BUDGET_POLICIES } from '../../../../domain/llm/budget-threshold';
import type { BudgetPolicy } from '../../../../domain/llm/budget-threshold';

export class UpsertBudgetDto {
  @ApiProperty({
    example: 50,
    minimum: 0,
    description:
      'Cap in DOLLARS — the only place in the contract that speaks in ' +
      'dollars, because that is what a person types. The api converts it to ' +
      'micro-USD, and responses come back in micro-USD.',
  })
  @IsNumber()
  @Min(0)
  limitUsd!: number;

  @ApiProperty({
    enum: BUDGET_POLICIES,
    example: 'block',
    description:
      '`block` refuses the call when it would exceed the cap; `allow` lets ' +
      'it through and only warns.',
  })
  @IsIn(['block', 'allow'])
  policy!: BudgetPolicy;
}
