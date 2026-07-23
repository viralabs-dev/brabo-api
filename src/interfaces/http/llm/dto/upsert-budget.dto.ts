import { IsIn, IsNumber, Min } from 'class-validator';
import type { BudgetPolicy } from '../../../../domain/llm/budget-threshold';

export class UpsertBudgetDto {
  @IsNumber()
  @Min(0)
  limitUsd!: number;

  @IsIn(['block', 'allow'])
  policy!: BudgetPolicy;
}
