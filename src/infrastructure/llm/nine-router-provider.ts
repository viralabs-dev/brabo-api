import { Injectable, Optional } from '@nestjs/common';
import type { ModeloDoCatalogo } from '@brabo/shared';
import { TokenEstimator } from '../../application/ports/token-estimator.port';
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
 * TODO(humano): o NOME do cabeçalho vem do build do 9Router v0.5.104; o
 * VALOR aceito (`off`) não foi achado na fonte. O smoke confere se o
 * `tool_result` chega intacto — é ele que diz se o valor vale.
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
 * `GET /v1/models` do 9Router: `{ data: [{ id, capabilities: { tools,
 * reasoning, thinkingCanDisable, maxOutput, contextWindow } }] }`. Sem preço:
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
  };
}

@Injectable()
export class NineRouterProvider extends OpenAICompatibleProvider {
  constructor(@Optional() tokenEstimator?: TokenEstimator) {
    super(nineRouterConfig(), tokenEstimator);
  }
}
