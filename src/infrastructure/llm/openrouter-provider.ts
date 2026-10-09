import { Injectable, Optional } from '@nestjs/common';
import type { ModeloDoCatalogo, RoutingPreference } from '@brabo/shared';
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
 * O critério de roteamento no formato do OpenRouter: `provider: { sort }`,
 * com o MESMO vocabulário de `RoutingPreference` (`price`, `throughput`,
 * `latency`). Só o `sort` — os outros campos do objeto `provider` (`order`,
 * `only`, `ignore`, `allow_fallbacks`, `max_price`) não foram pedidos e cada
 * um é decisão de produto própria (ADR 0166).
 */
export function campoDeRoteamentoOpenRouter(
  preferencia: RoutingPreference,
): Record<string, unknown> {
  return { provider: { sort: preferencia } };
}

/**
 * O teto de raciocínio no formato do OpenRouter: `reasoning: { max_tokens }`
 * (https://openrouter.ai/docs/use-cases/reasoning-tokens). Pela doc, o
 * `max_tokens` da chamada tem de ser MAIOR que o do raciocínio, para sobrar
 * saída — daí a soma em `buildBody` (RN-741). Modelo que só aceita `effort`
 * recebe a conversão do próprio hub. Nunca `exclude`/`enabled: false`: o
 * raciocínio não é desligado em silêncio.
 */
export function campoDeRaciocinioOpenRouter(
  orcamento: number,
): Record<string, unknown> {
  return { reasoning: { max_tokens: orcamento } };
}

/**
 * O custo REAL da chamada, que o OpenRouter devolve em `usage.cost` (USD, número
 * decimal) no frame final do stream (ADR 0188, RN-665). Vira micro-USD inteiro
 * pelo mesmo arredondamento do resto do metering.
 *
 * Com `is_byok: true` o custo NÃO é lido: numa chamada com a chave do próprio
 * provedor configurada no OpenRouter, `cost` é a taxa do hub, e a inferência é
 * cobrada pelo provedor por fora. Gravar só a taxa como "custo real" seria gravar
 * menos do que foi cobrado — o defeito que o ADR fecha — então a linha cai no
 * preço do catálogo, como antes. É LEITURA da doc, não medição: nenhuma chamada
 * BYOK foi feita (declarado no ADR 0188).
 *
 * Número negativo, não finito ou em string é "não disse", nunca zero.
 */
export function extrairCustoRealOpenRouter(
  usage: Record<string, unknown>,
): number | undefined {
  if (usage.is_byok === true) return undefined;
  const custo = usage.cost;
  if (typeof custo !== 'number' || !Number.isFinite(custo) || custo < 0) {
    return undefined;
  }
  return Math.round(custo * 1_000_000);
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
    capabilities: {
      streaming: true,
      toolCalling: true,
      listModels: true,
      // É o único dos oito de nuvem com credencial já provada no ambiente
      // (Fase 13a), e mesmo assim `false`: o smoke que rodou foi de CHAT. O
      // hub roteia embedding para provedores diferentes dos de chat, e a prova
      // de um endpoint não é prova do outro (ADR 0075).
      embeddings: false,
      // PROVADO em 2026-09-29 (ADR 0166, RN-583, AT-158):
      // `openrouter-provider.roteamento.smoke.spec.ts` rodou contra a API real
      // e o critério mudou o upstream que serviu (`price` → DeepInfra,
      // `throughput` → Groq, em `meta-llama/llama-3.3-70b-instruct`).
      // A prova vale para o fio `provider.sort` e o `provider` do frame;
      // qual upstream cada critério escolhe é decisão do hub e muda com o tempo.
      routingPreference: true,
    },
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
    campoDeRoteamento: campoDeRoteamentoOpenRouter,
    // Teto de raciocínio para modelo do catálogo com `supports_reasoning`
    // (RN-741). Forma lida da doc; a prova com credencial é TODO(humano).
    campoDeRaciocinio: campoDeRaciocinioOpenRouter,
    // O custo que o hub cobrou vira o número do metering (ADR 0188, RN-665).
    // Provado pela resposta GRAVADA na suíte de contrato (a forma de
    // `usage.cost` medida nas chamadas reais da medição de idioma, AT-163);
    // a prova com credencial, em stream, é o smoke `openrouter-provider.smoke`.
    extrairCustoReal: extrairCustoRealOpenRouter,
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
