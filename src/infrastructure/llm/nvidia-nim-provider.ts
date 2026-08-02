import { Injectable, Optional } from '@nestjs/common';
import { TokenEstimator } from '../../application/ports/token-estimator.port';
import {
  OpenAICompatibleProvider,
  type OpenAICompatibleConfig,
} from './openai-compatible-provider';

/**
 * O endpoint HOSPEDADO (`integrate.api.nvidia.com`), verificado nesta sessão
 * via doc oficial — NÃO o produto de container auto-hospedado (`docs.nvidia.com/nim`,
 * para deploy on-prem/VPC), que é outro produto com outro endereço.
 */
export const NVIDIA_NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1';

/**
 * Doc oficial verificada nesta sessão (WebFetch/WebSearch): `GET /v1/models`
 * existe (`id`/`object`/`created`/`owned_by`) mas NENHUMA doc encontrada traz
 * preço por token — catálogo real, porém inutilizável para o custo por
 * modelo que o metering exige (regra de capabilities em duas camadas, ADR
 * 0041). `listModels: false` é a resposta honesta; o provider vive de seed
 * manual (`apps/api/src/db/seed.ts`) até alguém confirmar um endpoint de
 * preço, se existir um dia.
 *
 * Tool calling é suportado só por MODELOS específicos, não pela API inteira
 * — mas isso não é um flag de config: `capabilities.toolCalling` só controla
 * se o parâmetro `tools` é enviado no corpo (confirmado em
 * `openai-compatible-provider.ts` — `buildBody`), o gate por modelo é
 * inteiramente `models.supports_tool_calling` (seed/curadoria), igual a
 * qualquer outro provider com suporte misto.
 */
export function nvidiaNimConfig(
  baseUrl: string = NVIDIA_NIM_BASE_URL,
): OpenAICompatibleConfig {
  return {
    name: 'nvidia-nim',
    baseUrl,
    capabilities: { streaming: true, toolCalling: true, listModels: false },
    authHeaders: (apiKey) => ({
      Authorization: `Bearer ${apiKey ?? ''}`,
    }),
    flags: {
      // Doc oficial não confirma `stream_options.include_usage` para o
      // endpoint HOSPEDADO (só para o software NIM auto-hospedado) — não
      // ligar sem prova. O fallback `estimated` da base já cobre o caso de
      // o campo ser ignorado (ver `openai-compatible-provider.ts:229-239`).
      streamOptionsIncludeUsage: false,
      maxTokensField: 'max_tokens',
    },
  };
}

/**
 * NVIDIA NIM (hospedado), o primeiro dos cinco da Fase 11b sobre a base
 * OpenAI-compatível (CLAUDE.md, ADR 0041/0042). `listModels: false` — ver o
 * comentário em `nvidiaNimConfig`.
 */
@Injectable()
export class NvidiaNimProvider extends OpenAICompatibleProvider {
  constructor(@Optional() tokenEstimator?: TokenEstimator) {
    super(nvidiaNimConfig(), tokenEstimator);
  }
}
