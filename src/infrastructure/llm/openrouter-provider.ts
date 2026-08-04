import { Injectable, Optional } from '@nestjs/common';
import type { ModeloDoCatalogo } from '@brabo/shared';
import { TokenEstimator } from '../../application/ports/token-estimator.port';
import {
  OpenAICompatibleProvider,
  type OpenAICompatibleConfig,
} from './openai-compatible-provider';
import {
  LLMAuthError,
  LLMConnectionError,
  LLMContextLengthExceededError,
  LLMModelNotFoundError,
  LLMProviderError,
  LLMRateLimitError,
  LLMTimeoutError,
  LLMUpstreamError,
  normalizeHttpStatus,
} from '../../domain/llm/llm-provider-errors';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * A doc oficial verificada nesta sessão (WebFetch/WebSearch, não memória) diz
 * que os dois são OPCIONAIS — atribuição/ranking no site do OpenRouter, não
 * exigência da API. Mandamos os dois de qualquer forma: não custa nada e evita
 * ficar de fora do ranking por omissão.
 *
 * `HTTP-Referer` reusa `API_PUBLIC_URL` (já existe para o callback de OAuth de
 * git, `start-git-oauth.use-case.ts`) em vez de criar uma variável nova para a
 * mesma pergunta — "qual é a URL pública deste deployment".
 */
function referer(): string {
  return process.env.API_PUBLIC_URL ?? 'http://localhost:3000';
}

const X_TITLE = 'Brabo';

/**
 * `pricing.prompt`/`pricing.completion` do catálogo do OpenRouter vêm como
 * STRING decimal em USD **por token** (ex.: `"0.0000025"`). O schema guarda
 * preço em micro-USD **por milhão** de tokens (`*PricePerMillionMicros`).
 *
 * USD/token → micro-USD/milhão: multiplica por 1e6 (tokens no milhão) e por
 * 1e6 de novo (USD → micro-USD) = 1e12. `Math.round` porque a coluna é
 * `bigint` inteiro, e o preço de fio tem mais casas decimais do que cabem sem
 * arredondar.
 */
function precoParaMicrosPorMilhao(precoPorToken: unknown): number | undefined {
  if (typeof precoPorToken !== 'string' && typeof precoPorToken !== 'number') {
    return undefined;
  }
  const numero = Number(precoPorToken);
  if (!Number.isFinite(numero) || numero < 0) return undefined;
  return Math.round(numero * 1e12);
}

interface LinhaDoCatalogoOpenRouter {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
  supported_parameters?: unknown;
  /**
   * `{modality, input_modalities, output_modalities, tokenizer, …}`. É daqui
   * que saem "aceita imagem" e "gera imagem" — o catálogo do OpenRouter publica
   * os dois e o parser os descartava, o que deixava `supports_vision` em
   * `false` para os 338 modelos.
   */
  architecture?: {
    input_modalities?: unknown;
    output_modalities?: unknown;
  };
}

/** `["text","image","file"]` → tem `image`? Lista ausente é "não declarou". */
function temModalidade(
  lista: unknown,
  modalidade: string,
): boolean | undefined {
  if (!Array.isArray(lista)) return undefined;
  return lista.includes(modalidade);
}

/**
 * O catálogo do OpenRouter, diferente do padrão `{ data: [{ id }] }` da
 * OpenAI, informa pricing/janela/capability na própria linha — exatamente o
 * caso que `ParseCatalogo` existe para cobrir sem `if` na base (Fase 9c).
 */
export function parseCatalogoOpenRouter(corpo: unknown): ModeloDoCatalogo[] {
  const data = (corpo as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];

  return data
    .map((linha) => linha as LinhaDoCatalogoOpenRouter)
    .filter((linha): linha is LinhaDoCatalogoOpenRouter & { id: string } => {
      return typeof linha.id === 'string' && linha.id.length > 0;
    })
    .map((linha) => {
      const parametros = Array.isArray(linha.supported_parameters)
        ? linha.supported_parameters
        : [];
      const precoEntrada = precoParaMicrosPorMilhao(linha.pricing?.prompt);
      const precoSaida = precoParaMicrosPorMilhao(linha.pricing?.completion);

      const entrada = temModalidade(
        linha.architecture?.input_modalities,
        'image',
      );
      const saida = temModalidade(
        linha.architecture?.output_modalities,
        'image',
      );

      return {
        name: linha.id,
        ...(typeof linha.name === 'string' && linha.name
          ? { displayName: linha.name }
          : {}),
        ...(typeof linha.context_length === 'number'
          ? { contextLength: linha.context_length }
          : {}),
        supportsToolCalling: parametros.includes('tools'),
        // `reasoning` no `supported_parameters` é como o OpenRouter declara
        // thinking — 213 dos 338 no catálogo de hoje.
        supportsReasoning: parametros.includes('reasoning'),
        // Omitidos quando o provider não declarou a modalidade: `undefined`
        // deixa o sync preservar o valor local em vez de zerá-lo.
        ...(entrada !== undefined ? { supportsVision: entrada } : {}),
        ...(saida !== undefined ? { generatesImage: saida } : {}),
        ...(precoEntrada !== undefined
          ? { inputPricePerMillionMicros: precoEntrada }
          : {}),
        ...(precoSaida !== undefined
          ? { outputPricePerMillionMicros: precoSaida }
          : {}),
      };
    });
}

/**
 * Mapa de string → `LLMErrorCode` para o erro NO MEIO do stream (ver
 * `ParseErrorFrame` na base). A doc oficial cita `error_type`/`error.code`
 * como string neste caso (diferente do erro pré-stream, cujo `code` é
 * numérico e já cai no `normalizeHttpStatus` comum via status HTTP) — a
 * enumeração completa não está 100% fechada na doc pública, então o mapeamento
 * é por SUBSTRING best-effort, com `upstream` como default seguro. O que
 * importa é que o erro NUNCA seja engolido: mesmo um código desconhecido vira
 * `upstream`, nunca silêncio.
 */
function mapearCodigoDeFrame(
  codigo: string,
  mensagem: string,
): LLMProviderError {
  const c = codigo.toLowerCase();
  if (c.includes('auth')) return new LLMAuthError('openrouter', mensagem);
  if (c.includes('rate_limit')) {
    return new LLMRateLimitError('openrouter', mensagem);
  }
  if (c.includes('context_length') || c.includes('token_limit')) {
    return new LLMContextLengthExceededError('openrouter', mensagem);
  }
  if (c.includes('not_found')) {
    return new LLMModelNotFoundError('openrouter', mensagem);
  }
  if (c.includes('timeout')) return new LLMTimeoutError('openrouter', mensagem);
  if (c.includes('disconnect') || c.includes('connection')) {
    return new LLMConnectionError('openrouter', mensagem);
  }
  return new LLMUpstreamError('openrouter', mensagem);
}

/**
 * Erro NO MEIO do stream (ver `ParseErrorFrame` na base): o OpenRouter aceita
 * a conexão, começa a mandar texto, e o provedor real por trás cai — a OpenAI
 * não tem esse modo de falha porque não roteia pra infraestrutura de
 * terceiros. O frame vem como
 * `{"error":{"code":"server_error","message":"..."},"choices":[{"delta":{},
 * "finish_reason":"error"}]}` — presença de `error` truthy é o sinal, não
 * `finish_reason` sozinho (que também aparece em fechamento normal).
 */
export function parseErrorFrameOpenRouter(
  frame: Record<string, unknown>,
): LLMProviderError | undefined {
  const erro = (frame as { error?: unknown }).error;
  if (!erro || typeof erro !== 'object') return undefined;

  const { code, message } = erro as { code?: unknown; message?: unknown };
  const mensagem =
    typeof message === 'string' && message
      ? message
      : 'openrouter reportou erro no meio do stream';

  if (typeof code === 'number') {
    return normalizeHttpStatus('openrouter', code, mensagem);
  }
  if (typeof code === 'string') {
    return mapearCodigoDeFrame(code, mensagem);
  }
  return new LLMUpstreamError('openrouter', mensagem);
}

/**
 * A extração é exportada à parte, como as demais funções de config deste
 * arquivo, para a suite de contrato exercitar ESTA config apontando pro
 * servidor falso — não uma cópia escrita no teste.
 */
export function openrouterConfig(
  baseUrl: string = OPENROUTER_BASE_URL,
): OpenAICompatibleConfig {
  return {
    name: 'openrouter',
    baseUrl,
    // `GET /v1/models` devolve pricing/janela/capability por linha — a base
    // já degradaria honestamente pra `false` se algum dia isso divergir.
    capabilities: { streaming: true, toolCalling: true, listModels: true },
    authHeaders: (apiKey) => ({
      Authorization: `Bearer ${apiKey ?? ''}`,
      'HTTP-Referer': referer(),
      'X-Title': X_TITLE,
    }),
    flags: {
      streamOptionsIncludeUsage: true,
      maxTokensField: 'max_tokens',
    },
    // Quem RESPONDEU de verdade, não quem foi pedido: o OpenRouter manda
    // `"provider":"openai"` direto no frame — mais correto que derivar do
    // prefixo do id do modelo, que é só o vendor PEDIDO.
    extrairUpstreamProvider: (frame) =>
      typeof frame.provider === 'string' ? frame.provider : undefined,
    parseErrorFrame: parseErrorFrameOpenRouter,
    parseCatalogo: parseCatalogoOpenRouter,
  };
}

/**
 * O primeiro hub sobre a base OpenAI-compatível (Fase 11a — CLAUDE.md,
 * ADR 0041/0042). `capabilities.listModels: true` tem efeito real aqui: o
 * `SyncModelCatalogUseCase` passa a descobrir o catálogo do OpenRouter sozinho
 * (RN-043 — modelo novo entra desativado, sumido é marcado, nunca apagado).
 */
@Injectable()
export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(@Optional() tokenEstimator?: TokenEstimator) {
    super(openrouterConfig(), tokenEstimator);
  }
}
