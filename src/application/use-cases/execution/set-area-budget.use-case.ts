import { BadRequestException, Injectable } from '@nestjs/common';
import { AgentAreaRepository } from '../../ports/agent-area-repository.port';

/**
 * O teto de GASTO de uma área, decidido pelo usuário (ADR 0109, RN-440).
 *
 * Espelha `SetAreaMaxParallelUseCase` — mesmo dono da decisão
 * (`maintainer`, mesma régua de "mudar o teto é decidir quanto o produto
 * gasta sem perguntar"), mesma ausência de evento de domínio (config de
 * projeto, sem sessão pra gravar). A diferença é `null`: `max_parallel`
 * nunca é "sem teto", mas gasto por área É opcional — a maioria dos
 * projetos nunca vai configurar um, e `null` é o default que preserva
 * isso.
 *
 * Recebe MICRO-USD já convertido (a conversão dólar→micro-USD é do
 * controller, mesmo padrão de `BudgetsController`/`UpsertBudgetUseCase`).
 */
@Injectable()
export class SetAreaBudgetUseCase {
  constructor(private readonly areas: AgentAreaRepository) {}

  async execute(projectId: string, key: string, budgetMicros: number | null) {
    if (
      budgetMicros !== null &&
      (!Number.isFinite(budgetMicros) || budgetMicros < 0)
    ) {
      throw new BadRequestException(
        `budgetMicros precisa ser null ou um número >= 0 (recebido: ${budgetMicros})`,
      );
    }

    return this.areas.setBudget(
      projectId,
      key,
      budgetMicros === null ? null : Math.round(budgetMicros),
    );
  }
}
