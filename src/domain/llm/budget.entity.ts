import type { BudgetPolicy } from './budget-threshold';

export type BudgetScope = 'project' | 'session' | 'workspace';

export interface Budget {
  id: string;
  projectId: string | null;
  sessionId: string | null;
  workspaceId: string | null;
  /** 1º dia do mês UTC do gasto; null na sessão (acumulada). ADR 0296. */
  periodoInicio: string | null;
  limitMicros: number;
  spentMicros: number;
  policy: BudgetPolicy;
  lastThresholdNotified: number;
  createdAt: Date;
  updatedAt: Date;
}
