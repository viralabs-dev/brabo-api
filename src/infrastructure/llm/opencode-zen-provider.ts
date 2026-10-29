import { Injectable, Optional } from '@nestjs/common';
import { TokenEstimator } from '../../application/ports/token-estimator.port';
import {
  OpenAICompatibleProvider,
  type OpenAICompatibleConfig,
} from './openai-compatible-provider';

/**
 * Só o dialeto OpenAI `/chat/completions` do OpenCode Zen (ADR 0227): os
 * modelos que falam `/responses`, `/messages` ou o dialeto Google ficam fora
 * da base compatível.
 */
export const OPENCODE_ZEN_BASE_URL = 'https://opencode.ai/inference/openai/v1';

/**
 * `listModels: false`: a lista de modelos do Zen mora em
 * `/inference/v1/models` (NÃO em `{baseUrl}/models`, que a base chama) e é
 * pública — o catálogo vem do seed curado (ADR 0042). Pelo mesmo motivo o
 * `LLMCredentialConnectionTester` não declara teste para ele: um GET público
 * passaria com chave inválida.
 *
 * Tudo `false` além do `streaming` até o smoke com chave rodar (ADR 0041).
 */
export function openCodeZenConfig(
  baseUrl: string = OPENCODE_ZEN_BASE_URL,
): OpenAICompatibleConfig {
  return {
    name: 'opencode-zen',
    baseUrl,
    capabilities: {
      streaming: true,
      toolCalling: false,
      listModels: false,
      embeddings: false,
      routingPreference: false,
      stickySession: false,
      priceCeiling: false,
      promptCaching: false,
    },
    authHeaders: (apiKey) => ({
      Authorization: `Bearer ${apiKey ?? ''}`,
    }),
    flags: {
      streamOptionsIncludeUsage: false,
      maxTokensField: 'max_tokens',
    },
  };
}

@Injectable()
export class OpenCodeZenProvider extends OpenAICompatibleProvider {
  constructor(@Optional() tokenEstimator?: TokenEstimator) {
    super(openCodeZenConfig(), tokenEstimator);
  }
}
