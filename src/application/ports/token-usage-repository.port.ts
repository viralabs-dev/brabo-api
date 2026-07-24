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
}
