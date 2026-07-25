import { IsIn, IsInt, IsOptional, IsPositive } from 'class-validator';
import {
  DEV_AGENT_IMPLS,
  type DevAgentImpl,
} from '../../../../domain/execution/dev-agent-impl';

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

  // Implementação dos dev agents — omitido usa 'real'. 'noop' sobe o
  // NoopDevAgentServer (sem LLM), pra validar a infraestrutura de execução
  // de ponta a ponta sem custo de token. Ver domain/execution/dev-agent-impl.
  @IsOptional()
  @IsIn(DEV_AGENT_IMPLS)
  devAgentImpl?: DevAgentImpl;
}
