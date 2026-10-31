import { MENSAGEM_SEM_MODELO } from '../../../domain/llm/binding-resolver';
import { Injectable, Logger } from '@nestjs/common';
import type {
  ChatMessage,
  LLMErrorCode,
  ToolCall,
  ToolDef,
} from '@brabo/shared';
import { LLMProviderError } from '../../../domain/llm/llm-provider-errors';
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
import {
  DecidirFerramentaDoPassoUseCase,
  type ToolRouting,
} from './decidir-ferramenta-do-passo.use-case';
import {
  chaveDeSessao,
  preferenciaEnviada,
  tetoDePreco,
  devoRetentarSemTeto,
  FATOR_DO_TETO_DE_PRECO,
} from '../../../domain/llm/routing-preference';
import { custoDaChamada } from '../../../domain/llm/custo-da-chamada';
import {
  devoRetentarSemRaciocinio,
  opcoesDeRaciocinio,
} from '../../../domain/llm/raciocinio-do-agente';
import {
  caudaQuePodeSerMarcador,
  marcacaoDeChamadaEmTexto,
} from '../../../domain/llm/chamada-em-texto';
import type { Actor } from '../../../domain/sessions/session-event.entity';

export interface StreamLlmTurnInput {
  projectId: string;
  sessionId: string;
  agentId?: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  /** O engine repete o passo com o catálogo inteiro quando o menu do Jev estava errado (ADR 0179). */
  catalogoCompleto?: boolean;
}

export interface LlmTurnUsage {
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  estimated: boolean;
}

export type LlmTurnStreamEvent =
  | { type: 'delta'; text: string }
  // Antes de qualquer `delta`: o Jev está escolhendo a ferramenta (AT-236
  // resposta 16). Aditivo — o engine ignora frame de tipo desconhecido.
  | { type: 'tool_routing_started' }
  | {
      type: 'final';
      message: { role: 'assistant'; content: string; toolCalls: ToolCall[] };
      usage: LlmTurnUsage;
      error: string | null;
      /**
       * O `code` normalizado do erro do provider (ADR 0041), quando o erro veio
       * dele; `null` sem erro ou com erro que não é do provider. O engine decide
       * crédito esgotado por ele (RN-730). Campo aditivo.
       */
      errorCode: LLMErrorCode | null;
      // Nome do modelo que gerou a resposta (achado do problema 2) — antes só
      // vivia em `token_usage`, sem vínculo com o evento `agent.response`
      // específico que ele produziu. `null` quando o turno falhou ANTES de
      // resolver um modelo (`!binding`/`!model`); nos demais casos (inclusive
      // budget excedido) o binding já resolveu e o nome viaja.
      modelName: string | null;
      /** Ver `RunLlmTurnResult.truncated` (RN-737). */
      truncated?: true;
      /** Ver `RunLlmTurnResult.toolRouting` (ADR 0179). */
      toolRouting?: ToolRouting;
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
const teto_logger = new Logger('TetoDePreco');

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
    private readonly resolveCredentialOwner: ResolveCredentialOwnerUseCase,
    private readonly decidirFerramenta: DecidirFerramentaDoPassoUseCase,
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
      yield finalError(MENSAGEM_SEM_MODELO);
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
      input.agentId,
    );
    if (gate.blocked) {
      yield finalError(gate.reason ?? 'Budget excedido', model.name);
      return;
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
        yield finalError(
          `Nenhuma credencial cadastrada para ${model.provider}`,
        );
        return;
      }
      apiKey = this.encryption.decrypt(secret);
    }

    const provider = this.llmProviders.get(model.provider);
    // O critério do binding VENCEDOR, e só se este provider o declara — é o
    // que vai ao fio e o que congela no metering (ADR 0166, RN-583).
    const routingPreference = preferenciaEnviada(
      binding.routingPreference,
      provider.capabilities,
    );
    // ADR 0225 (RN-917): teto de preço por chamada, só no hub que o declara.
    const teto = tetoDePreco(model, provider.capabilities);
    // O Jev escolhe a ferramenta do passo (ADR 0179) — nunca derruba o turno.
    const roteamento = {
      projectId: input.projectId,
      sessionId: input.sessionId,
      agentId: input.agentId,
      provider: model.provider,
      apiKey,
      messages: input.messages,
      tools: input.tools,
      catalogoCompleto: input.catalogoCompleto,
    };
    const plano = await this.decidirFerramenta.preparar(roteamento);
    if (plano) yield { type: 'tool_routing_started' };
    const decisaoDoJev = plano
      ? await this.decidirFerramenta.executar(plano, roteamento)
      : { tools: input.tools, toolRouting: null, messages: input.messages };
    const opcoes = opcoesDeRaciocinio(
      model.supportsReasoning,
      input.agentId,
      model.reasoningBudget,
    );
    // AT-587 (RN-916): no máximo DUAS chamadas; a segunda com o raciocínio desligado.
    let semRaciocinio = false;
    let semTeto = false;
    let semChamadaEmTexto = false;
    const nomesDeFerramenta = (decisaoDoJev.tools ?? []).map((t) => t.name);
    for (;;) {
      const comTeto = teto !== null && !semTeto;
      let fullText = '';
      let toolCalls: ToolCall[] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      let estimated = false;
      // Só um hub preenche isto; nos providers diretos fica null (Fase 9b).
      let upstreamProvider: string | null = null;
      // O que a resposta disse sobre si (ADR 0188, RN-665): o custo que o
      // provider cobrou, o modelo que serviu e o id da geração.
      let custoRealMicros: number | null = null;
      let resolvedModelName: string | null = null;
      let generationId: string | null = null;
      // Stream abortado pelo orçamento de raciocínio: custo é estimativa (ADR 0224).
      let abortado = false;
      // Partes da entrada/saída que o provider informou (RN-666); `null` = não disse.
      let cachedInputTokens: number | null = null;
      let reasoningTokens: number | null = null;
      let streamError: string | null = null;
      // O provider disse que o teto de saída cortou a resposta (RN-737).
      let truncated = false;
      let streamErrorCode: LLMErrorCode | null = null;
      let emitido = 0;
      let parado = false;

      try {
        for await (const chunk of provider.chat(decisaoDoJev.messages, {
          model: model.name,
          apiKey,
          tools: decisaoDoJev.tools,
          ...(routingPreference ? { routingPreference } : {}),
          sessionKey: chaveDeSessao(input.sessionId, input.agentId),
          ...opcoes,
          ...(semRaciocinio ? { reasoningOff: true as const } : {}),
          ...(comTeto ? { priceCeiling: teto } : {}),
        })) {
          if (chunk.type === 'text_delta') {
            fullText += chunk.text;
            // AT-633: a partir do marcador nada mais sai; o fim que pode ser
            // início de marcador fica retido até a próxima parte.
            if (
              !parado &&
              nomesDeFerramenta.length > 0 &&
              marcacaoDeChamadaEmTexto(fullText, nomesDeFerramenta)
            )
              parado = true;
            if (!parado) {
              const ate = fullText.length - caudaQuePodeSerMarcador(fullText);
              if (ate > emitido) {
                yield { type: 'delta', text: fullText.slice(emitido, ate) };
                emitido = ate;
              }
            }
          } else if (chunk.type === 'tool_calls') {
            toolCalls = toolCalls.concat(chunk.toolCalls);
          } else if (chunk.type === 'usage') {
            inputTokens = chunk.inputTokens;
            outputTokens = chunk.outputTokens;
            estimated = chunk.estimated;
            upstreamProvider = chunk.upstreamProvider ?? null;
            custoRealMicros = chunk.costMicros ?? null;
            resolvedModelName = chunk.resolvedModel ?? null;
            generationId = chunk.generationId ?? null;
            abortado = chunk.abortadoPeloRaciocinio === true;
            cachedInputTokens = chunk.cachedInputTokens ?? null;
            reasoningTokens = chunk.reasoningTokens ?? null;
          } else if (chunk.type === 'truncated') {
            truncated = true;
          } else if (chunk.type === 'error') {
            streamError = chunk.message;
            streamErrorCode = chunk.code;
          }
        }
      } catch (error) {
        streamError = (error as Error).message;
        if (error instanceof LLMProviderError) streamErrorCode = error.code;
      }

      // Solta a cauda retida, se o texto não virou marcador.
      if (!parado && emitido < fullText.length)
        yield { type: 'delta', text: fullText.slice(emitido) };

      // Metering OBRIGATÓRIO — mesmo com erro do provider.
      if (inputTokens === 0 && outputTokens === 0) {
        inputTokens = this.tokenEstimator.count(
          input.messages.map((m) => m.content).join('\n'),
        );
        outputTokens = this.tokenEstimator.count(fullText);
        estimated = true;
      }
      // O custo REAL, quando o provider o devolveu, é o número; senão, o preço do
      // catálogo congelado (ADR 0042). Decisão do dono, ADR 0188 (RN-665).
      const custo = custoDaChamada({
        inputTokens,
        outputTokens,
        custoRealMicros,
        inputPricePerMillionMicros: model.inputPricePerMillionMicros,
        outputPricePerMillionMicros: model.outputPricePerMillionMicros,
      });
      const { costMicros } = custo;
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
          // um número sem procedência quando o preço mudar (RN-044). Com custo
          // real, o preço é o IMPLÍCITO e o do catálogo vai ao lado (ADR 0188).
          inputPricePerMillionMicros: custo.inputPricePerMillionMicros,
          outputPricePerMillionMicros: custo.outputPricePerMillionMicros,
          priceImplicit: custo.priceImplicit || abortado,
          custoAReconciliar: abortado && generationId !== null,
          catalogCostMicros: custo.catalogCostMicros,
          resolvedModelName,
          generationId,
          cachedInputTokens,
          reasoningTokens,
          latencyMs,
          bindingOrigin: binding.origin,
          upstreamProvider,
          routingPreference,
          priceCeilingFactor: comTeto ? FATOR_DO_TETO_DE_PRECO : null,
        });
      });

      // ADR 0225 (RN-917): nenhum upstream coube no teto — repete UMA vez sem
      // teto (a linha desta chamada grava o fator nulo); o turno não falha.
      if (devoRetentarSemTeto({ comTeto, errorCode: streamErrorCode })) {
        teto_logger.warn(
          `${model.provider}/${model.name}: nenhum upstream cabe no teto de preço; repetindo sem teto`,
        );
        semTeto = true;
        continue;
      }
      // AT-633 (RN-949): a chamada veio escrita como TEXTO — UMA retentativa,
      // flag própria; na segunda, falha NOMEADA (origem modelo) e o texto cru
      // nunca sai da api.
      const marcador =
        toolCalls.length === 0
          ? marcacaoDeChamadaEmTexto(fullText, nomesDeFerramenta)
          : null;
      if (marcador && !semChamadaEmTexto) {
        semChamadaEmTexto = true;
        continue;
      }
      if (marcador) {
        yield {
          ...falhaDeChamadaEmTexto(model.name, marcador),
          type: 'final',
          usage: { inputTokens, outputTokens, costMicros, estimated },
        };
        return;
      }
      if (
        !semRaciocinio &&
        devoRetentarSemRaciocinio({
          opcoes,
          aceitaRaciocinioDesligado: provider.aceitaRaciocinioDesligado,
          truncated: truncated,
          texto: fullText,
          toolCalls: toolCalls.length,
          abortado,
          reasoningTokens,
        })
      ) {
        semRaciocinio = true;
        continue;
      }
      yield {
        type: 'final',
        message: { role: 'assistant', content: fullText, toolCalls },
        usage: { inputTokens, outputTokens, costMicros, estimated },
        error: streamError,
        errorCode: streamErrorCode,
        modelName: model.name,
        ...(truncated ? { truncated: true as const } : {}),
        ...(decisaoDoJev.toolRouting
          ? { toolRouting: decisaoDoJev.toolRouting }
          : {}),
      };
      return;
    }
  }
}

function finalError(
  message: string,
  modelName: string | null = null,
): LlmTurnStreamEvent {
  return {
    type: 'final',
    message: { role: 'assistant', content: '', toolCalls: [] },
    usage: { inputTokens: 0, outputTokens: 0, costMicros: 0, estimated: true },
    error: message,
    errorCode: null,
    modelName,
  };
}

/** AT-633 (RN-949): a segunda resposta também veio com a chamada escrita como texto. */
function falhaDeChamadaEmTexto(modelName: string, marcador: string) {
  return {
    message: { role: 'assistant' as const, content: '', toolCalls: [] },
    error: `O modelo ${modelName} escreveu a chamada de ferramenta como texto (${marcador}) em vez de usar o canal de ferramentas, duas vezes seguidas.`,
    errorCode: 'tool_call_as_text' as LLMErrorCode,
    modelName,
  };
}
