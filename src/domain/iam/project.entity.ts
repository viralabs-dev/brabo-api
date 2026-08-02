export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  createdBy: string;
  // Teto de tokens por task dos dev agents (micro-USD). Nulo = default do
  // domínio (ver DEFAULT_TASK_BUDGET_MICROS em ActivateExecutionUseCase).
  taskBudgetMicros: number | null;
  // Circuit breaker por dev agent (Fase 12b, RN-047): tasks TERMINANDO
  // blocked em sequência até parar em idle_tripped. Nulo = default do
  // domínio (ver DEFAULT_MAX_CONSECUTIVE_BLOCKED em ActivateExecutionUseCase).
  maxConsecutiveBlocked: number | null;
  createdAt: Date;
  updatedAt: Date;
}
