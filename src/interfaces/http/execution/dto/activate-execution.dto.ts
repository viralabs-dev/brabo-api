import { IsInt, IsOptional, IsPositive } from 'class-validator';

export class ActivateExecutionDto {
  // Orçamento de tokens por task, em micro-USD — omitido usa o default
  // (ver DEFAULT_TASK_BUDGET_MICROS em ActivateExecutionUseCase).
  @IsOptional()
  @IsInt()
  @IsPositive()
  taskBudgetMicros?: number;

  // Teto de correções dev↔gate (QA/SecOps) antes da task virar blocked —
  // omitido usa o default (ver DEFAULT_MAX_GATE_CORRECTIONS em
  // RecordGateVerdictUseCase).
  @IsOptional()
  @IsInt()
  @IsPositive()
  maxGateCorrections?: number;
}
