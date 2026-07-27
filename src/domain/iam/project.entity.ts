export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  createdBy: string;
  // Teto de tokens por task dos dev agents (micro-USD). Nulo = default do
  // domínio (ver DEFAULT_TASK_BUDGET_MICROS em ActivateExecutionUseCase).
  taskBudgetMicros: number | null;
  createdAt: Date;
  updatedAt: Date;
}
