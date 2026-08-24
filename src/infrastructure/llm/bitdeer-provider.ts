import { Injectable, Optional } from '@nestjs/common';
import { TokenEstimator } from '../../application/ports/token-estimator.port';
import {
  OpenAICompatibleProvider,
  type OpenAICompatibleConfig,
} from './openai-compatible-provider';

export const BITDEER_BASE_URL = 'https://api-inference.bitdeer.ai/v1';

/**
 * A doc pública da Bitdeer é a mais rasa dos cinco da Fase 11b — a página de
 * preço (`bitdeer.ai/en/pricing/ai-models`) renderiza via JS e não expõe
 * número nenhum a uma busca não-interativa, e nenhuma doc de referência com
 * exemplo de request/response de `/chat/completions` foi encontrada
 * publicamente. O que FOI confirmado nesta sessão, com fonte:
 *
 * - `Authorization: Bearer <API_KEY>` — exemplo de curl real encontrado
 *   (doc da API de embeddings da Bitdeer, mesmo padrão do resto);
 * - `GET /v1/models` existe e é AUTENTICADO (401 ao vivo sem chave);
 * - a claim de compatibilidade OpenAI ("API endpoints adhere to OpenAI REST
 *   API standards") mais o uso direto do SDK oficial da OpenAI apontado só
 *   pra `base_url`/`api_key` — mas SEM um exemplo real de resposta.
 *
 * `listModels: false` é a única resposta honesta: não há shape de preço
 * verificado pra escrever um `parseCatalogo` que não seja invenção.
 */
export function bitdeerConfig(
  baseUrl: string = BITDEER_BASE_URL,
): OpenAICompatibleConfig {
  return {
    name: 'bitdeer',
    baseUrl,
    capabilities: {
      streaming: true,
      toolCalling: true,
      listModels: false,
      // A doc citada acima é justamente a de EMBEDDINGS da Bitdeer — e é só
      // isso que existe: leitura. Sem chave no ambiente, nenhum smoke provou o
      // endpoint, e a regra do ADR 0043 é clara sobre declarar por doc (custou
      // duas reversões ao vivo). Fica `false`, e a base recusa a chamada.
      embeddings: false,
    },
    authHeaders: (apiKey) => ({
      Authorization: `Bearer ${apiKey ?? ''}`,
    }),
    flags: {
      // Nenhuma doc encontrada confirma ou nega — mesmo tratamento cauteloso
      // dos outros dois sem confirmação (NIM, Together); fallback `estimated`
      // da base cobre o caso de o campo ser ignorado.
      streamOptionsIncludeUsage: false,
      maxTokensField: 'max_tokens',
    },
  };
}

/**
 * Bitdeer, o quarto dos cinco da Fase 11b sobre a base OpenAI-compatível
 * (CLAUDE.md, ADR 0041/0042) — o de doc pública mais rasa dos cinco.
 * `listModels: false`, sem `parseCatalogo`/`parseErrorFrame` próprios: nada
 * além do dialeto OpenAI padrão foi confirmado o suficiente pra virar código.
 */
@Injectable()
export class BitdeerProvider extends OpenAICompatibleProvider {
  constructor(@Optional() tokenEstimator?: TokenEstimator) {
    super(bitdeerConfig(), tokenEstimator);
  }
}
