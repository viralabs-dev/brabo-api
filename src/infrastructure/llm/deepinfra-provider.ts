import { Injectable, Optional } from '@nestjs/common';
import type { ModeloDoCatalogo } from '@brabo/shared';
import { TokenEstimator } from '../../application/ports/token-estimator.port';
import {
  OpenAICompatibleProvider,
  type OpenAICompatibleConfig,
} from './openai-compatible-provider';

/** A superfície OpenAI-compatível — DeepInfra também tem endpoints nativos
 * (`/v1/inference/{model}`) fora desta base, que este provider não usa. */
export const DEEPINFRA_BASE_URL = 'https://api.deepinfra.com/v1/openai';

/**
 * `GET {baseUrl}/models` (o MESMO endpoint que a base chama por padrão —
 * nenhuma extensão de base foi necessária) devolve, confirmado AO VIVO nesta
 * sessão:
 *
 * ```json
 * { "object": "list", "data": [{
 *   "id": "deepseek-ai/DeepSeek-V3",
 *   "object": "model",
 *   "metadata": {
 *     "context_length": 163840,
 *     "pricing": { "input_tokens": 0.32, "output_tokens": 0.89 },
 *     "tags": ["chat"]
 *   }
 * }] }
 * ```
 *
 * A MESMA lista mistura chat, imagem, áudio e vídeo — cada tipo com um
 * shape de `pricing` diferente (`per_image_unit`, `input_characters`,
 * `output_seconds`, ...). O filtro por `tags.includes('chat')` E presença
 * de `input_tokens`/`output_tokens` numéricos é o que garante que só modelo
 * de CHAT vira linha do catálogo — sem isso, um modelo de imagem entraria
 * com preço fabricado a partir de um campo que não é "por token" nenhum.
 */
function precoParaMicrosPorMilhao(preco: unknown): number | undefined {
  if (typeof preco !== 'number' || !Number.isFinite(preco) || preco < 0) {
    return undefined;
  }
  return Math.round(preco * 1_000_000);
}

interface LinhaDoCatalogoDeepInfra {
  id?: unknown;
  metadata?: {
    context_length?: unknown;
    pricing?: { input_tokens?: unknown; output_tokens?: unknown };
    tags?: unknown;
  };
}

export function parseCatalogoDeepInfra(corpo: unknown): ModeloDoCatalogo[] {
  const data = (corpo as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];

  return data
    .map((linha) => linha as LinhaDoCatalogoDeepInfra)
    .filter((linha): linha is LinhaDoCatalogoDeepInfra & { id: string } => {
      if (typeof linha.id !== 'string' || linha.id.length === 0) return false;
      const tags = linha.metadata?.tags;
      return Array.isArray(tags) && tags.includes('chat');
    })
    .map((linha) => {
      const precoEntrada = precoParaMicrosPorMilhao(
        linha.metadata?.pricing?.input_tokens,
      );
      const precoSaida = precoParaMicrosPorMilhao(
        linha.metadata?.pricing?.output_tokens,
      );
      const contextLength = linha.metadata?.context_length;

      return {
        name: linha.id,
        ...(typeof contextLength === 'number' ? { contextLength } : {}),
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
 * Doc oficial verificada nesta sessão: o endpoint (confirmado AO VIVO) é
 * PÚBLICO, sem autenticação nenhuma — o que resolve a favor de
 * `listModels: true` (a URL que a base chama por padrão já tem o preço, sem
 * precisar de extensão nenhuma), mas também significa que ele NÃO serve
 * como teste de conexão: uma chave inválida devolveria o mesmo 200 que uma
 * válida. Nenhum endpoint de validação foi encontrado — `deepinfra` fica
 * sem tester declarado (NO-OP, mesmo tratamento de `ollama`/`anthropic`/
 * `openai` hoje) até alguém confirmar um endpoint autenticado de verdade.
 */
export function deepinfraConfig(
  baseUrl: string = DEEPINFRA_BASE_URL,
): OpenAICompatibleConfig {
  return {
    name: 'deepinfra',
    baseUrl,
    capabilities: { streaming: true, toolCalling: true, listModels: true },
    authHeaders: (apiKey) => ({
      Authorization: `Bearer ${apiKey ?? ''}`,
    }),
    flags: {
      // Documentado como suportado (docs.deepinfra.com/chat/streaming) —
      // diferente de NIM/Together, aqui está confirmado.
      streamOptionsIncludeUsage: true,
      maxTokensField: 'max_tokens',
    },
    parseCatalogo: parseCatalogoDeepInfra,
  };
}

/**
 * DeepInfra, o terceiro dos cinco da Fase 11b sobre a base OpenAI-compatível
 * (CLAUDE.md, ADR 0041/0042).
 */
@Injectable()
export class DeepInfraProvider extends OpenAICompatibleProvider {
  constructor(@Optional() tokenEstimator?: TokenEstimator) {
    super(deepinfraConfig(), tokenEstimator);
  }
}
