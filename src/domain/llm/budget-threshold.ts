export const BUDGET_THRESHOLDS = [70, 90, 100] as const;
export type BudgetThreshold = (typeof BUDGET_THRESHOLDS)[number];

export const BUDGET_POLICIES = ['block', 'allow'] as const;
export type BudgetPolicy = (typeof BUDGET_POLICIES)[number];

/**
 * Quais thresholds (70/90/100) o gasto acumulado atual ultrapassa que
 * ainda não tinham sido notificados. `alreadyNotified` é o maior
 * threshold já emitido (persistido em budgets.last_threshold_notified)
 * — usar só ele (não o gasto anterior) como piso evita re-disparo
 * mesmo se uma única chamada pular direto de 0% pra 100%.
 */
export function crossedThresholds(
  newSpentMicros: number,
  limitMicros: number,
  alreadyNotified: number,
): BudgetThreshold[] {
  if (limitMicros <= 0) return [];
  const newRatio = newSpentMicros / limitMicros;
  return BUDGET_THRESHOLDS.filter(
    (threshold) => threshold > alreadyNotified && newRatio >= threshold / 100,
  );
}

/** policy 'allow' nunca bloqueia; 'block' recusa a partir de 100% do limite. */
export function isBlocked(
  spentMicros: number,
  limitMicros: number,
  policy: BudgetPolicy,
): boolean {
  if (policy !== 'block') return false;
  if (limitMicros <= 0) return false;
  return spentMicros >= limitMicros;
}
