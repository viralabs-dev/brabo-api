import { IsInt, IsOptional, IsPositive } from 'class-validator';

export class ActivateExecutionDto {
  // Orçamento de tokens por task, em micro-USD — omitido usa o default
  // (ver DEFAULT_TASK_BUDGET_MICROS em ActivateExecutionUseCase).
  @IsOptional()
  @IsInt()
  @IsPositive()
  taskBudgetMicros?: number;
}
