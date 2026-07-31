import type { LLMProviderName } from '@brabo/shared';
import type { TokenUsage } from '../../domain/llm/token-usage.entity';
import type { Actor } from '../../domain/sessions/session-event.entity';
import type { ModelBindingScope } from '../../domain/llm/model-binding-scope';

export interface RecordTokenUsageInput {
  sessionId: string;
  actor: Actor;
  provider: LLMProviderName;
  modelId: string | null;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  costMicros: number;
  latencyMs: number;
  bindingOrigin: ModelBindingScope | null;
}

export abstract class TokenUsageRepository {
  abstract record(input: RecordTokenUsageInput): Promise<TokenUsage>;
  // Soma de costMicros pra uma sessão, filtrado por actor id (Fase 4b —
  // Psicólogo: custo da análise, somando ['psicologo','psicologo-leve'],
  // usado só pra exibição — o metering "de verdade" já é gravado
  // incondicionalmente por RecordLlmUsageUseCase pra QUALQUER agente).
  abstract sumBySessionAndActorIds(
    sessionId: string,
    actorIds: string[],
  ): Promise<number>;
  // Custo por AGENTE numa sessão (Fase 4a — painel do time). O dado sempre
  // esteve em token_usage, mas não havia agregação nem rota: o painel não
  // tinha como mostrar "tokens da sessão" por AgentCard, que é o que o
  // enunciado pede. Ver ADR 0021.
  abstract sumBySessionGroupedByActor(
    sessionId: string,
  ): Promise<AgentTokenUsage[]>;
  // Resumo do workspace pro dashboard de projetos (Fase de fidelidade da
  // UI): "M agentes" e o gasto do mês, numa query só. `actorKind = 'agent'`
  // é filtro OBRIGATÓRIO — sem ele um `user` mandando chat ou um `system`
  // registrando uso infla a contagem de agentes (RN-038).
  abstract summarizeForWorkspaceThisMonth(
    workspaceId: string,
  ): Promise<WorkspaceTokenUsageSummary>;
}

export interface AgentTokenUsage {
  actorId: string;
  costMicros: number;
  inputTokens: number;
  outputTokens: number;
}

export interface WorkspaceTokenUsageSummary {
  agentCount: number;
  spentMicros: number;
}
