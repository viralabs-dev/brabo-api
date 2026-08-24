/**
 * Teto de gasto de UMA ÁREA (`agent_areas.budget_micros`/`spent_micros`,
 * ADR 0110, RN-443).
 *
 * ADITIVO, não cascata — não confundir com a cascata de binding de modelo
 * (`sessão > agente > área > projeto > workspace`, ADR 0064). Aqui não há
 * "o mais específico vence": projeto, sessão e área são TRÊS tetos
 * independentes, e qualquer um deles bloqueado já recusa a chamada — o
 * mesmo desenho de `CheckBudgetGateUseCase` para projeto/sessão desde o
 * dia um, só que sem `policy` (área não tem `allow`: sem teto configurado
 * é o único jeito de "não bloquear", e configurar teto sempre bloqueia ao
 * atingi-lo — não há opção de só avisar).
 */

/** `null` em `budgetMicros` é SEM TETO — nunca bloqueia. */
export function isAreaBudgetExceeded(
  spentMicros: number,
  budgetMicros: number | null,
): boolean {
  if (budgetMicros == null) return false;
  return spentMicros >= budgetMicros;
}
