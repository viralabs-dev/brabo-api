import { Injectable, Optional } from '@nestjs/common';
import { TokenEstimator } from '../../application/ports/token-estimator.port';
import {
  OpenAICompatibleProvider,
  type OpenAICompatibleConfig,
} from './openai-compatible-provider';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

/**
 * A configuração é exportada à parte para que a suite de contrato exercite
 * ESTA configuração apontando para o servidor falso — e não uma cópia dela
 * escrita no teste, que passaria verde mesmo se a de produção divergisse.
 */
export function openaiConfig(
  baseUrl: string = OPENAI_BASE_URL,
): OpenAICompatibleConfig {
  return {
    name: 'openai',
    baseUrl,
    // `GET /v1/models` é o endpoint canônico do dialeto e a base já o fala.
    capabilities: {
      streaming: true,
      toolCalling: true,
      listModels: true,
      // A OpenAI é quem DEFINE o `/embeddings` que a base fala, e ainda assim
      // fica `false`: não há `OPENAI_TEST_KEY` no ambiente, e a suite de
      // contrato prova o DIALETO (contra o servidor falso), não que esta chave
      // acessa aquele endpoint. Vira `true` no commit em que um smoke com
      // credencial real passar — não antes (ADR 0043/0075).
      embeddings: false,
    },
    authHeaders: (apiKey) => ({ Authorization: `Bearer ${apiKey ?? ''}` }),
    flags: {
      streamOptionsIncludeUsage: true,
      // `max_completion_tokens` é o nome novo, mas `max_tokens` continua
      // aceito e é o que os compatíveis entendem — trocar aqui quebraria os
      // clones da Fase 9b sem ganhar nada nos modelos que usamos.
      maxTokensField: 'max_tokens',
    },
  };
}

/**
 * A OpenAI é a primeira instância da base compatível (Fase 9a — ADR 0041), não
 * um provider com parsing próprio. Antes disto ela usava o SDK `openai` e
 * descartava `options.tools` em silêncio; a base trouxe tool calling, erros
 * normalizados e teto de inatividade de socket.
 *
 * Continua sendo uma classe com este nome porque o registry e o módulo de DI a
 * referenciam por tipo — quem chama não vê diferença nenhuma.
 */
@Injectable()
export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(@Optional() tokenEstimator?: TokenEstimator) {
    super(openaiConfig(), tokenEstimator);
  }
}
