import type { BudgetPolicy } from './budget-threshold';

export type BudgetScope = 'project' | 'session';

export interface Budget {
  id: string;
  projectId: string | null;
  sessionId: string | null;
  limitMicros: number;
  spentMicros: number;
  policy: BudgetPolicy;
  lastThresholdNotified: number;
  createdAt: Date;
  updatedAt: Date;
}
