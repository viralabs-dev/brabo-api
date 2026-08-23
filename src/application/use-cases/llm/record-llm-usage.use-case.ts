import { Injectable } from '@nestjs/common';
import type { LLMProviderName } from '@brabo/shared';
import { TokenUsageRepository } from '../../ports/token-usage-repository.port';
import { BudgetRepository } from '../../ports/budget-repository.port';
import { AgentAreaRepository } from '../../ports/agent-area-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { BraboMetrics } from '../../../infrastructure/observability/brabo-metrics';
import { crossedThresholds } from '../../../domain/llm/budget-threshold';
import type { Budget } from '../../../domain/llm/budget.entity';
import type { Actor } from '../../../domain/sessions/session-event.entity';
import type { ModelBindingScope } from '../../../domain/llm/model-binding-scope';
import type { TokenUsage } from '../../../domain/llm/token-usage.entity';
import { areaDo } from '../../../domain/agents/agent-areas';

export interface RecordLlmUsageInput {
  projectId: string;
  sessionId: string;
  actor: Actor;
  provider: LLMProviderName;
  modelId: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  costMicros: number;
  /**
   * O preço do modelo NO MOMENTO da chamada (Fase 9c, RN-044). Vem do
   * orquestrador, que já leu a linha de `models` para calcular o custo — e é
   * gravado junto para o custo ficar reproduzível quando o preço mudar.
   */
  inputPricePerMillionMicros: number;
  outputPricePerMillionMicros: number;
  latencyMs: number;
  bindingOrigin: ModelBindingScope | null;
  /** Só quando um hub informou quem serviu de fato (Fase 9b). */
  upstreamProvider?: string | null;
}

/**
 * ÚNICO caminho pra gravar metering — "obrigatório" por construção:
 * grava token_usage e incrementa 0/1/2 budgets (projeto e/ou sessão,
 * cada um independentemente), emitindo outbox de threshold sempre que
 * cruzar 70/90/100%, e — quando o ator pertence a uma área (ADR 0053) —
 * incrementa o `spentMicros` dela também (ADR 0109), SEMPRE, com ou sem
 * teto configurado. Chamado sempre dentro da transação do use case
 * orquestrador (SendChatMessageUseCase).
 */
@Injectable()
export class RecordLlmUsageUseCase {
  constructor(
    private readonly tokenUsage: TokenUsageRepository,
    private readonly budgets: BudgetRepository,
    private readonly areas: AgentAreaRepository,
    private readonly outbox: OutboxRepository,
    private readonly metrics: BraboMetrics,
  ) {}

  async execute(input: RecordLlmUsageInput): Promise<TokenUsage> {
    // Métricas aqui e não no chamador: este é o ÚNICO caminho de metering do
    // sistema, então a métrica herda a mesma garantia de cobertura que o
    // `token_usage` — não há chamada de LLM contabilizada no banco e ausente
    // do Prometheus, nem o contrário.
    this.metrics.recordLlmUsage({
      projectId: input.projectId,
      provider: input.provider,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      costMicros: input.costMicros,
      latencyMs: input.latencyMs,
      upstreamProvider: input.upstreamProvider ?? null,
    });

    const usage = await this.tokenUsage.record({
      sessionId: input.sessionId,
      actor: input.actor,
      provider: input.provider,
      modelId: input.modelId,
      modelName: input.modelName,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      estimated: input.estimated,
      costMicros: input.costMicros,
      inputPricePerMillionMicros: input.inputPricePerMillionMicros,
      outputPricePerMillionMicros: input.outputPricePerMillionMicros,
      latencyMs: input.latencyMs,
      bindingOrigin: input.bindingOrigin,
      upstreamProvider: input.upstreamProvider ?? null,
    });

    const [projectBudget, sessionBudget] = await Promise.all([
      this.budgets.findForProject(input.projectId),
      this.budgets.findForSession(input.sessionId),
    ]);

    await this.applyToBudget(projectBudget, input.costMicros);
    await this.applyToBudget(sessionBudget, input.costMicros);
    await this.applyToArea(input.projectId, input.actor, input.costMicros);

    return usage;
  }

  /**
   * Sem cascata: `actor.kind !== 'agent'` (usuário no chat) ou agente sem
   * área (`areaDo` devolve `undefined`) simplesmente não incrementam nada —
   * "não faz nada nocivo quando o ator não tem área" é o requisito, não
   * erro silencioso disfarçado.
   */
  private async applyToArea(
    projectId: string,
    actor: Actor,
    deltaMicros: number,
  ): Promise<void> {
    if (actor.kind !== 'agent') return;
    const area = areaDo(actor.id);
    if (!area) return;

    await this.areas.incrementSpent(projectId, area.key, deltaMicros);
  }

  private async applyToBudget(
    budget: Budget | null,
    deltaMicros: number,
  ): Promise<void> {
    if (!budget) return;

    const updated = await this.budgets.incrementSpent(budget.id, deltaMicros);
    const crossed = crossedThresholds(
      updated.spentMicros,
      updated.limitMicros,
      updated.lastThresholdNotified,
    );
    if (crossed.length === 0) return;

    await this.budgets.updateLastNotified(
      budget.id,
      crossed[crossed.length - 1],
    );

    for (const threshold of crossed) {
      await this.outbox.append({
        aggregateType: 'budget',
        aggregateId: budget.id,
        eventType: 'budget.threshold_crossed',
        payload: {
          scope: budget.projectId ? 'project' : 'session',
          scopeId: budget.projectId ?? budget.sessionId,
          threshold,
          spentMicros: updated.spentMicros,
          limitMicros: updated.limitMicros,
        },
      });
    }
  }
}
