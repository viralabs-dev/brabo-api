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
import { ResolveCredentialOwnerUseCase } from './resolve-credential-owner.use-case';
import { calculateCostMicros } from '../../../domain/llm/cost-calculator';
import type { Actor } from '../../../domain/sessions/session-event.entity';

export interface RunLlmTurnInput {
  projectId: string;
  sessionId: string;
  agentId?: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
}

export interface RunLlmTurnResult {
  message: { role: 'assistant'; content: string; toolCalls: ToolCall[] };
  usage: {
    inputTokens: number;
    outputTokens: number;
    costMicros: number;
    estimated: boolean;
  };
  error: string | null;
  // Espelha `LlmTurnStreamEvent.modelName` (achado do problema 2) — `null`
  // quando o turno falhou antes de resolver um modelo.
  modelName: string | null;
}

/**
 * Um TURNO de LLM chamado pelo harness do engine (ToolLoop / ContextManager)
 * via endpoint interno — turno-a-turno, NÃO-streamado pro chamador (o stream
 * do provider é consumido aqui dentro e acumulado). Espelha o fluxo metered
 * de SendChatMessageUseCase (resolve binding → budget gate → provider →
 * grava token_usage OBRIGATÓRIO), mas NÃO grava session_events: o engine é
 * dono da narrativa no event log (agent.response, tool.call, tool.result).
 */
@Injectable()
export class RunLlmTurnUseCase {
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
    private readonly resolveCredentialOwner: ResolveCredentialOwnerUseCase,
  ) {}

  async execute(input: RunLlmTurnInput): Promise<RunLlmTurnResult> {
    const startedAt = Date.now();

    const binding = await this.resolveModelBinding.execute({
      projectId: input.projectId,
      sessionId: input.sessionId,
      agentId: input.agentId,
      // Fase 9c: o gatilho é o turno CARREGAR ferramentas, não o ator ser
      // agente — um turno de resumo do context-manager sem `tools` roda bem em
      // modelo chat-only, e travá-lo restringiria mais do que a RN-040 pede.
      exigeToolCalling: (input.tools?.length ?? 0) > 0,
    });
    if (!binding) {
      return errorResult('Nenhum modelo vinculado para esta sessão');
    }
    const model = await this.models.findById(binding.modelId);
    if (!model) {
      return errorResult('Modelo vinculado não encontrado');
    }

    // Budget FAIL-CLOSED antes de gastar tokens.
    const gate = await this.checkBudgetGate.execute(
      input.projectId,
      input.sessionId,
      input.agentId,
    );
    if (gate.blocked) {
      return errorResult(gate.reason ?? 'Budget excedido', model.name);
    }

    let apiKey: string | undefined;
    if (model.provider !== 'ollama') {
      // O dono da chave é o OWNER DO WORKSPACE, não o agente. Passar o slug
      // aqui — `agentId ?? sessionId` — mandava "criativo" para uma coluna
      // UUID e derrubava a query; o erro virava resposta vazia e nenhum agente
      // conseguia usar provider com credencial.
      const dono = await this.resolveCredentialOwner.execute(input.projectId);
      const secret = await this.credentials.findSecretByUserAndProvider(
        dono,
        model.provider,
      );
      if (!secret) {
        return errorResult(
          `Nenhuma credencial cadastrada para ${model.provider}`,
        );
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

    return {
      message: { role: 'assistant', content: fullText, toolCalls },
      usage: { inputTokens, outputTokens, costMicros, estimated },
      error: streamError,
      modelName: model.name,
    };
  }
}

function errorResult(
  message: string,
  modelName: string | null = null,
): RunLlmTurnResult {
  return {
    message: { role: 'assistant', content: '', toolCalls: [] },
    usage: { inputTokens: 0, outputTokens: 0, costMicros: 0, estimated: true },
    error: message,
    modelName,
  };
}
