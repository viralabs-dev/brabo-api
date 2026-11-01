import { Injectable, Logger, Optional } from '@nestjs/common';
import type {
  ChatMessage,
  ChatOptions,
  ChatStreamChunk,
  ModeloDoCatalogo,
} from '@brabo/shared';
import { TokenEstimator } from '../../application/ports/token-estimator.port';
import { normalizeHttpStatus } from '../../domain/llm/llm-provider-errors';
import { getJson } from './http-stream';
import {
  OpenAICompatibleProvider,
  type OpenAICompatibleConfig,
} from './openai-compatible-provider';

/**
 * O 9Router roda na máquina do dono (fora do compose), então a URL é da
 * INSTALAÇÃO e não fixa (ADR 0222). Lida a cada uso: o `.env` manda.
 */
export const NINE_ROUTER_BASE_URL_PADRAO =
  'http://host.docker.internal:20128/v1';

export function nineRouterBaseUrl(): string {
  const url = process.env.NINE_ROUTER_BASE_URL?.trim();
  return (url || NINE_ROUTER_BASE_URL_PADRAO).replace(/\/+$/, '');
}

/**
 * O "RTK Token Saver" do 9Router COMPRIME `tool_result` e faria o modelo ler
 * algo diferente do que o harness gravou no log. O Brabo pede desligado em
 * toda chamada.
 *
 * Medido no 9Router 0.5.112 (bundle, `chunks/8895.js`): `off`, sem caixa,
 * desliga RTK, Headroom, Caveman e Ponytail JUNTOS; o Custom Prompt não passa
 * por esse cabeçalho. A medição da AT-631 confirmou o efeito ("ok" sem ele =
 * 1 262 tokens). Ver RN-966.
 */
export const NINE_ROUTER_TOKEN_SAVER_HEADER = 'x-9router-token-saver';
export const NINE_ROUTER_TOKEN_SAVER_OFF = 'off';

interface LinhaDoCatalogo9Router {
  id?: unknown;
  name?: unknown;
  capabilities?: {
    tools?: unknown;
    reasoning?: unknown;
    contextWindow?: unknown;
  };
}

/**
 * `GET /v1/models` do 9Router: `{ data: [{ id, <campo capabilities> com tools,
 * reasoning, thinkingCanDisable, maxOutput, contextWindow }] }`. Sem preço:
 * ele vem da curadoria manual (ADR 0042) — por decisão do dono, o preço
 * público da API equivalente, mesmo para modelo de assinatura.
 */
export function parseCatalogo9Router(corpo: unknown): ModeloDoCatalogo[] {
  const data = (corpo as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];

  return data
    .map((linha) => linha as LinhaDoCatalogo9Router)
    .filter((l): l is LinhaDoCatalogo9Router & { id: string } => {
      return typeof l.id === 'string' && l.id.length > 0;
    })
    .map((l) => {
      const cap = l.capabilities;
      return {
        name: l.id,
        ...(typeof l.name === 'string' && l.name
          ? { displayName: l.name }
          : {}),
        ...(typeof cap?.contextWindow === 'number'
          ? { contextLength: cap.contextWindow }
          : {}),
        ...(typeof cap?.tools === 'boolean'
          ? { supportsToolCalling: cap.tools }
          : {}),
        ...(typeof cap?.reasoning === 'boolean'
          ? { supportsReasoning: cap.reasoning }
          : {}),
      };
    });
}

/**
 * O 9Router 0.5.112 SOMA 2 000 a `prompt_tokens` no frame final (`O9`, no
 * bundle dele), inclusive sobre o usage estimado (AT-638, RN-958). Só as
 * versões nesta tabela são corrigidas: subtrair numa versão que consertou o
 * bug gravaria MENOS do que foi cobrado.
 */
export const INFLACAO_DE_PROMPT_POR_VERSAO: Readonly<Record<string, number>> = {
  '0.5.112': 2000,
};

const TETO_DA_VERSAO_MS = 2000;
const logger = new Logger('NineRouterProvider');
const avisadas = new Set<string>();

/** `currentVersion` de `GET <origem>/api/version` (público), ou `undefined`. */
export async function versaoDo9Router(
  baseUrl: string,
): Promise<string | undefined> {
  try {
    const { status, body } = await getJson({
      url: `${new URL(baseUrl).origin}/api/version`,
      headers: {},
      timeoutMs: TETO_DA_VERSAO_MS,
      timeoutEnvName: 'timeout fixo de 2 s da versão',
      provider: '9router',
    });
    if (status !== 200) return undefined;
    const v = (JSON.parse(body) as { currentVersion?: unknown }).currentVersion;
    return typeof v === 'string' && v ? v : undefined;
  } catch {
    return undefined;
  }
}

function normalizarUsage9Router(
  usage: Record<string, unknown>,
  versao: string | undefined,
): Record<string, unknown> {
  const saida = { ...usage };
  const inflacao = versao ? INFLACAO_DE_PROMPT_POR_VERSAO[versao] : undefined;
  if (inflacao !== undefined && typeof saida.prompt_tokens === 'number') {
    saida.prompt_tokens = Math.max(0, saida.prompt_tokens - inflacao);
  } else if (inflacao === undefined && !avisadas.has(versao ?? '?')) {
    avisadas.add(versao ?? '?');
    logger.warn(
      `9Router ${versao ?? 'de versão ilegível'} sem correção de usage conhecida: gravado como veio`,
    );
  }
  // `cached_tokens` vem no TOPO do usage; a base lê o aninhado.
  const topo = saida.cached_tokens;
  const detalhes = saida.prompt_tokens_details as
    { cached_tokens?: unknown } | undefined;
  if (
    typeof topo === 'number' &&
    Number.isInteger(topo) &&
    topo >= 0 &&
    detalhes?.cached_tokens === undefined
  ) {
    saida.prompt_tokens_details = { ...detalhes, cached_tokens: topo };
  }
  return saida;
}

/**
 * O 9Router devolve 503 `[<status>]: <msg> (reset after Ns)` quando TODAS as
 * contas estão em cooldown por um 4xx do upstream (AT-639, RN-959). Classifica
 * pelo status de dentro; 5xx de dentro ou ausente segue `upstream` passageiro.
 */
export function classificarErro9Router(
  status: number,
  corpo: string,
): ReturnType<NonNullable<OpenAICompatibleConfig['classificarErroHttp']>> {
  if (status !== 503 || !/reset after/i.test(corpo)) return undefined;
  const interno = Number(/\[(4\d\d)\]:/.exec(corpo)?.[1]);
  return interno ? normalizeHttpStatus('9router', interno, corpo) : undefined;
}

/**
 * `streaming: true` é o que a suite de contrato exige de TODO provider (a base
 * só fala SSE). As demais ficam `false` além do `listModels`: nenhum smoke
 * com chave rodou ainda (ADR 0041) — o 9Router depende mais de prova que os
 * outros, porque o upstream muda por combo. EXCETO `toolCalling: true`
 * (RN-950), PROVADO por smoke com chave real em 2026-10-31: 3/3 chamadas em
 * `cc/claude-haiku-5-5` devolveram `tool_calls` estruturado, 10/10 consistente
 * a temperatura 0 e laço de 3 voltas íntegro.
 */
export function nineRouterConfig(
  baseUrl: string = nineRouterBaseUrl(),
  versao: () => string | undefined = () => undefined,
): OpenAICompatibleConfig {
  return {
    name: '9router',
    baseUrl,
    capabilities: {
      streaming: true,
      toolCalling: true,
      listModels: true,
      embeddings: false,
      routingPreference: false,
      stickySession: false,
      priceCeiling: false,
      promptCaching: false,
    },
    authHeaders: (apiKey) => ({
      Authorization: `Bearer ${apiKey ?? ''}`,
      [NINE_ROUTER_TOKEN_SAVER_HEADER]: NINE_ROUTER_TOKEN_SAVER_OFF,
    }),
    flags: {
      streamOptionsIncludeUsage: false,
      maxTokensField: 'max_tokens',
    },
    parseCatalogo: parseCatalogo9Router,
    classificarErroHttp: classificarErro9Router,
    normalizarUsage: (usage) => normalizarUsage9Router(usage, versao()),
  };
}

@Injectable()
export class NineRouterProvider extends OpenAICompatibleProvider {
  private readonly versao: { valor?: string; ate: number };

  constructor(@Optional() tokenEstimator?: TokenEstimator) {
    const versao: { valor?: string; ate: number } = { ate: 0 };
    super(
      nineRouterConfig(undefined, () => versao.valor),
      tokenEstimator,
    );
    this.versao = versao;
  }

  /** Versão lida antes do stream: cache de 5 min no sucesso, 1 min na falha. */
  async *chat(
    messages: ChatMessage[],
    options: ChatOptions,
  ): AsyncGenerator<ChatStreamChunk> {
    if (Date.now() >= this.versao.ate) {
      const v = await versaoDo9Router(nineRouterBaseUrl());
      this.versao.valor = v;
      this.versao.ate = Date.now() + (v ? 300_000 : 60_000);
    }
    yield* super.chat(messages, options);
  }
}
