import { Injectable, Optional } from '@nestjs/common';
import { TokenEstimator } from '../../application/ports/token-estimator.port';
import {
  OpenAICompatibleProvider,
  type OpenAICompatibleConfig,
} from './openai-compatible-provider';

export const VULTR_BASE_URL = 'https://api.vultrinference.com/v1';

/**
 * Doc oficial verificada nesta sessão (WebFetch/WebSearch): tool calling
 * confirmado com exemplo real (`docs.vultr.com/how-to-use-tool-calling-with-vultr-serverless-inference`,
 * modelo `kimi-k2-instruct`, resposta com `finish_reason: "tool_calls"` —
 * dialeto OpenAI padrão, sem campo estranho nenhum nesse exemplo).
 *
 * `listModels: false` — decisão que MUDOU durante a implementação em
 * relação ao plano original (que apontava `true`): a base SEMPRE chama
 * `{baseUrl}/models` (`openai-compatible-provider.ts`, `listModels()`), e a
 * própria referência oficial da Vultr (`api.vultrinference.com`) descreve
 * `GET /models` como devolvendo só `id`/`created`/`object`/`owned_by`/
 * `features` — SEM preço. O endpoint com preço documentado (`GET /provider`,
 * com `cost`/`contextWindow`) devolveu 404 ao vivo no caminho testado
 * nesta sessão — dado insuficiente pra escrever um `parseCatalogo` real
 * sem arriscar apontar pra uma URL errada ("true frágil"). `GET /v1/models`
 * em si está confirmado (401 ao vivo sem chave, duas vezes) — só não tem
 * preço na doc.
 */
export function vultrConfig(
  baseUrl: string = VULTR_BASE_URL,
): OpenAICompatibleConfig {
  return {
    name: 'vultr',
    baseUrl,
    capabilities: { streaming: true, toolCalling: true, listModels: false },
    authHeaders: (apiKey) => ({
      Authorization: `Bearer ${apiKey ?? ''}`,
    }),
    flags: {
      // Doc oficial não confirma `stream_options.include_usage` — não ligar
      // sem prova; fallback `estimated` da base cobre.
      streamOptionsIncludeUsage: false,
      maxTokensField: 'max_tokens',
    },
  };
}

/**
 * Vultr Serverless Inference, o último dos cinco da Fase 11b sobre a base
 * OpenAI-compatível (CLAUDE.md, ADR 0041/0042). `listModels: false` — ver o
 * comentário em `vultrConfig` sobre a mudança de decisão durante a
 * implementação.
 */
@Injectable()
export class VultrProvider extends OpenAICompatibleProvider {
  constructor(@Optional() tokenEstimator?: TokenEstimator) {
    super(vultrConfig(), tokenEstimator);
  }
}
