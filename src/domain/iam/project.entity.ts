// QUEM promove uma story de draft para ready (Fase 12c, RN-048). Espelha o
// enum `story_promotion_mode` do banco.
export const STORY_PROMOTION_MODES = ['manual', 'auto'] as const;
export type StoryPromotionMode = (typeof STORY_PROMOTION_MODES)[number];

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
  // Quem promove story a `ready` (Fase 12c, RN-048). NOT NULL: ao contrário
  // dos tetos acima, aqui não existe "nulo = default do domínio" — o valor É
  // a decisão de autoridade, e ela não fica implícita.
  storyPromotion: StoryPromotionMode;
  createdAt: Date;
  updatedAt: Date;
}
