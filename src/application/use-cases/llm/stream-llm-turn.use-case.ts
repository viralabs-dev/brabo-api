import { Injectable } from '@nestjs/common';
import type { ChatMessage, ToolCall, ToolDef } from '@brabo/shared';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ModelRepository } from '../../ports/model-repository.port';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';
import { EncryptionService } from '../../ports/encryption.port';
import { LLMProviderRegistry } from '../../ports/llm-provider-registry.port';
import { TokenEstimator } from '../../ports/token-estimator.port';
import { ResolveModelBindingUseCase } from './resolve-model-binding.use-case';
import { CheckBudgetGateUseCase } from './check-budget-gate.use-case';
import { RecordLlmUsageUseCase } from './record-llm-usage.use-case';
import { calculateCostMicros } from '../../../domain/llm/cost-calculator';
import type { Actor } from '../../../domain/sessions/session-event.entity';

export interface StreamLlmTurnInput {
  projectId: string;
  sessionId: string;
  agentId?: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
}

export interface LlmTurnUsage {
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  estimated: boolean;
}

export type LlmTurnStreamEvent =
  | { type: 'delta'; text: string }
  | {
      type: 'final';
      message: { role: 'assistant'; content: string; toolCalls: ToolCall[] };
      usage: LlmTurnUsage;
      error: string | null;
    };

/**
 * Versão STREAMADA do RunLlmTurnUseCase (Fase 3a, que permanece turn-result
 * pro ToolLoop/EchoAgent). Usada pelos agentes CONVERSACIONAIS (Criativo): o
 * engine consome esta SSE e repassa os deltas ao web pelo canal Phoenix, e ao
 * fim recebe a mensagem completa (com toolCalls) pra despachar as ferramentas.
 * Mesmo fluxo metered (resolve binding → budget gate fail-closed → provider →
 * grava token_usage OBRIGATÓRIO), e NÃO grava session_events — o engine é dono
 * da narrativa no event log.
 */
@Injectable()
export class StreamLlmTurnUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly models: ModelRepository,
    private readonly credentials: UserCredentialRepository,
    private readonly encryption: EncryptionService,
    private readonly llmProviders: LLMProviderRegistry,
    private readonly tokenEstimator: TokenEstimator,
    private readonly resolveModelBinding: ResolveModelBindingUseCase,
    private readonly checkBudgetGate: CheckBudgetGateUseCase,
    private readonly recordLlmUsage: RecordLlmUsageUseCase,
  ) {}

  async *execute(
    input: StreamLlmTurnInput,
  ): AsyncGenerator<LlmTurnStreamEvent> {
    const startedAt = Date.now();

    const binding = await this.resolveModelBinding.execute({
      projectId: input.projectId,
      sessionId: input.sessionId,
      agentId: input.agentId,
      // Mesmo critério do RunLlmTurnUseCase (Fase 9c): quem pede ferramentas
      // precisa de um modelo que saiba pedi-las, em qualquer nível da cascata.
      exigeToolCalling: (input.tools?.length ?? 0) > 0,
    });
    if (!binding) {
      yield finalError('Nenhum modelo vinculado para esta sessão');
      return;
    }
    const model = await this.models.findById(binding.modelId);
    if (!model) {
      yield finalError('Modelo vinculado não encontrado');
      return;
    }

    const gate = await this.checkBudgetGate.execute(
      input.projectId,
      input.sessionId,
    );
    if (gate.blocked) {
      yield finalError(gate.reason ?? 'Budget excedido');
      return;
    }

    let apiKey: string | undefined;
    if (model.provider !== 'ollama') {
      const secret = await this.credentials.findSecretByUserAndProvider(
        input.agentId ?? input.sessionId,
        model.provider,
      );
      if (!secret) {
        yield finalError(
          `Nenhuma credencial cadastrada para ${model.provider}`,
        );
        return;
      }
      apiKey = this.encryption.decrypt(secret);
    }

    const provider = this.llmProviders.get(model.provider);
    let fullText = '';
    let toolCalls: ToolCall[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let estimated = false;
    // Só um hub preenche isto; nos providers diretos fica null (Fase 9b).
    let upstreamProvider: string | null = null;
    let streamError: string | null = null;

    try {
      for await (const chunk of provider.chat(input.messages, {
        model: model.name,
        apiKey,
        tools: input.tools,
      })) {
        if (chunk.type === 'text_delta') {
          fullText += chunk.text;
          yield { type: 'delta', text: chunk.text };
        } else if (chunk.type === 'tool_calls') {
          toolCalls = toolCalls.concat(chunk.toolCalls);
        } else if (chunk.type === 'usage') {
          inputTokens = chunk.inputTokens;
          outputTokens = chunk.outputTokens;
          estimated = chunk.estimated;
          upstreamProvider = chunk.upstreamProvider ?? null;
        } else if (chunk.type === 'error') {
          streamError = chunk.message;
        }
      }
    } catch (error) {
      streamError = (error as Error).message;
    }

    // Metering OBRIGATÓRIO — mesmo com erro do provider.
    if (inputTokens === 0 && outputTokens === 0) {
      inputTokens = this.tokenEstimator.count(
        input.messages.map((m) => m.content).join('\n'),
      );
      outputTokens = this.tokenEstimator.count(fullText);
      estimated = true;
    }
    const costMicros = calculateCostMicros(
      inputTokens,
      outputTokens,
      model.inputPricePerMillionMicros,
      model.outputPricePerMillionMicros,
    );
    const latencyMs = Date.now() - startedAt;
    const actor: Actor = { kind: 'agent', id: input.agentId ?? model.name };

    await this.unitOfWork.runInTransaction(async () => {
      await this.recordLlmUsage.execute({
        projectId: input.projectId,
        sessionId: input.sessionId,
        actor,
        provider: model.provider,
        modelId: model.id,
        modelName: model.name,
        inputTokens,
        outputTokens,
        estimated,
        costMicros,
        // Congela o preço junto do custo: sem isso o `cost_micros` de ontem é
        // um número sem procedência quando o preço mudar (RN-044).
        inputPricePerMillionMicros: model.inputPricePerMillionMicros,
        outputPricePerMillionMicros: model.outputPricePerMillionMicros,
        latencyMs,
        bindingOrigin: binding.origin,
        upstreamProvider,
      });
    });

    yield {
      type: 'final',
      message: { role: 'assistant', content: fullText, toolCalls },
      usage: { inputTokens, outputTokens, costMicros, estimated },
      error: streamError,
    };
  }
}

function finalError(message: string): LlmTurnStreamEvent {
  return {
    type: 'final',
    message: { role: 'assistant', content: '', toolCalls: [] },
    usage: { inputTokens: 0, outputTokens: 0, costMicros: 0, estimated: true },
    error: message,
  };
}
