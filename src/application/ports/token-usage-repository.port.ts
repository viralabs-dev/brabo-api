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
  /** O preço vigente no instante da chamada (Fase 9c, RN-044). */
  inputPricePerMillionMicros: number;
  outputPricePerMillionMicros: number;
  latencyMs: number;
  bindingOrigin: ModelBindingScope | null;
  upstreamProvider: string | null;
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

  /**
   * Custo por AGENTE no projeto, nos últimos 30 dias — a coluna "EST. MÊS" e o
   * card de custo do time que o mockup de Configurações desenha
   * (`design/SCREENS.md`). O dado sempre esteve em `token_usage`; faltava a
   * agregação por projeto, e a coluna vivia com um traço fixo.
   *
   * Janela DESLIZANTE de 30 dias, e não o mês corrente do
   * `summarizeForWorkspaceThisMonth`: o rótulo do desenho é "com base no
   * histórico de 30 dias", e no dia 1º um mês-calendário mostraria quase zero
   * — a estimativa despencaria por virada de página, não por mudança de uso.
   *
   * `actorKind = 'agent'` é filtro OBRIGATÓRIO pelo mesmo motivo do método
   * acima (RN-038): sem ele, um usuário conversando no chat entraria na conta
   * do agente cujo nome ele nem carrega.
   */
  abstract sumByProjectGroupedByAgentLast30Days(
    projectId: string,
  ): Promise<AgentTokenUsage[]>;
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
