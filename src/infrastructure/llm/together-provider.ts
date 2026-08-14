import { Injectable, Optional } from '@nestjs/common';
import type { ModeloDoCatalogo } from '@brabo/shared';
import { TokenEstimator } from '../../application/ports/token-estimator.port';
import {
  OpenAICompatibleProvider,
  type OpenAICompatibleConfig,
} from './openai-compatible-provider';

/** `.ai`, não `.xyz` — o domínio antigo aparece em material desatualizado. */
export const TOGETHER_BASE_URL = 'https://api.together.ai/v1';

/**
 * `pricing.input`/`pricing.output` do catálogo da Together vêm como NÚMERO,
 * já em USD **por milhão** de tokens — diferente do OpenRouter, que manda
 * string decimal em USD **por token**. A doc oficial (`docs.together.ai/reference/models`)
 * NÃO documenta a unidade explicitamente; a inferência é por comparação com
 * preço de mercado publicado (ex.: Llama 3.3 70B listado a US$ 1,04/1M em
 * together.ai/models — na mesma ordem de grandeza do exemplo `"input": 0.3`
 * do schema oficial, o que só faz sentido como USD/milhão: como USD/token
 * seria US$ 300.000/milhão, um preço absurdo). O smoke test
 * (`together-provider.smoke.spec.ts`, credencial real) é quem confirma isto
 * de vez — se o preço sincronizado destoar do que a Together anuncia, é
 * ESTE comentário que está errado, não o smoke.
 */
function precoParaMicrosPorMilhao(preco: unknown): number | undefined {
  if (typeof preco !== 'number' || !Number.isFinite(preco) || preco < 0) {
    return undefined;
  }
  return Math.round(preco * 1_000_000);
}

interface LinhaDoCatalogoTogether {
  id?: unknown;
  display_name?: unknown;
  context_length?: unknown;
  pricing?: { input?: unknown; output?: unknown };
}

/**
 * Igual à OpenAI no essencial (`{ data: [{ id, ... }] }`), mas cada linha já
 * traz `display_name`, `context_length` e `pricing` — daí o parser próprio,
 * no mesmo molde do `parseCatalogoOpenRouter` (Fase 11a).
 */
export function parseCatalogoTogether(corpo: unknown): ModeloDoCatalogo[] {
  const data = (corpo as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];

  return data
    .map((linha) => linha as LinhaDoCatalogoTogether)
    .filter((linha): linha is LinhaDoCatalogoTogether & { id: string } => {
      return typeof linha.id === 'string' && linha.id.length > 0;
    })
    .map((linha) => {
      const precoEntrada = precoParaMicrosPorMilhao(linha.pricing?.input);
      const precoSaida = precoParaMicrosPorMilhao(linha.pricing?.output);

      return {
        name: linha.id,
        ...(typeof linha.display_name === 'string' && linha.display_name
          ? { displayName: linha.display_name }
          : {}),
        ...(typeof linha.context_length === 'number'
          ? { contextLength: linha.context_length }
          : {}),
        // Nenhum flag de capability de tool calling no catálogo (doc
        // verificada nesta sessão) — nunca inventar `true`/`false` aqui;
        // ausência de campo fica ausente, curadoria decide (RN-043).
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
 * Doc oficial verificada nesta sessão: `GET /v1/models` documentado com
 * `pricing` usável — `listModels: true` é a resposta honesta (diferente da
 * NIM, que não tem preço em doc nenhuma).
 */
export function togetherConfig(
  baseUrl: string = TOGETHER_BASE_URL,
): OpenAICompatibleConfig {
  return {
    name: 'together',
    baseUrl,
    capabilities: {
      streaming: true,
      toolCalling: true,
      listModels: true,
      // Sem `TOGETHER_TEST_KEY` no ambiente nenhum smoke rodou contra o
      // `/embeddings` real (ADR 0075).
      embeddings: false,
    },
    authHeaders: (apiKey) => ({
      Authorization: `Bearer ${apiKey ?? ''}`,
    }),
    flags: {
      // Doc oficial não confirma `stream_options.include_usage` — não ligar
      // sem prova; o fallback `estimated` da base cobre o caso de o campo
      // ser ignorado.
      streamOptionsIncludeUsage: false,
      maxTokensField: 'max_tokens',
    },
    parseCatalogo: parseCatalogoTogether,
  };
}

/**
 * Together AI, o segundo dos cinco da Fase 11b sobre a base OpenAI-compatível
 * (CLAUDE.md, ADR 0041/0042). Ids de modelo são NAMESPACED
 * (`meta-llama/Llama-3.3-70B-Instruct-Turbo`) — um id "achatado" tipo OpenAI
 * responde 404, então nunca inventar um id sem o prefixo do vendor.
 */
@Injectable()
export class TogetherProvider extends OpenAICompatibleProvider {
  constructor(@Optional() tokenEstimator?: TokenEstimator) {
    super(togetherConfig(), tokenEstimator);
  }
}
