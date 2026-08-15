import type { EmbeddingResult, LLMProviderName } from '@brabo/shared';
import { LLMUpstreamError } from '../../domain/llm/llm-provider-errors';

/**
 * A montagem do `EmbeddingResult` a partir do que veio do fio (ADR 0075),
 * compartilhada pelos dialetos — o `/embeddings` da OpenAI e o `/api/embed` do
 * Ollama divergem no SHAPE, nunca no que precisa ser garantido.
 *
 * O valor daqui é recusar cedo. Um vetor a menos, uma dimensão que varia entre
 * as linhas da mesma resposta, um número que veio como string: nada disso
 * derruba nada na hora, e todos derrubam a BUSCA semanas depois, longe da
 * causa. Esta função existe para que a falha aconteça onde ela é diagnóstica.
 */
export interface MontarEmbeddingInput {
  provider: LLMProviderName;
  /** Quantas entradas foram pedidas — um vetor para cada, sem exceção. */
  esperados: number;
  modeloPedido: string;
  vetores: number[][];
  /** O que o provider disse ter usado; ausente cai no pedido. */
  modeloRespondido: unknown;
  /** Contagem informada pelo provider; ausente vira `estimated: true`. */
  inputTokens: unknown;
}

export function montarEmbedding(input: MontarEmbeddingInput): EmbeddingResult {
  const { provider, esperados, vetores } = input;

  if (vetores.length !== esperados) {
    throw new LLMUpstreamError(
      provider,
      `embedding devolveu ${vetores.length} vetor(es) para ${esperados} ` +
        `entrada(s) — a ordem é o único vínculo entre entrada e vetor, então ` +
        `uma lista de tamanho diferente não é aproveitável`,
    );
  }

  const dimensions = vetores[0].length;
  if (dimensions === 0) {
    throw new LLMUpstreamError(
      provider,
      'embedding devolveu vetor vazio — um índice que aceita isso grava ' +
        '"nenhuma semelhança com nada" em vez de falhar',
    );
  }
  const divergente = vetores.findIndex((v) => v.length !== dimensions);
  if (divergente !== -1) {
    throw new LLMUpstreamError(
      provider,
      `embedding devolveu dimensões diferentes na mesma resposta ` +
        `(${dimensions} e ${vetores[divergente].length}) — um índice vetorial ` +
        `tem dimensão fixa`,
    );
  }

  const informado = typeof input.inputTokens === 'number';

  return {
    vectors: vetores,
    dimensions,
    model:
      typeof input.modeloRespondido === 'string' && input.modeloRespondido
        ? input.modeloRespondido
        : input.modeloPedido,
    inputTokens: informado ? (input.inputTokens as number) : 0,
    // Mesma distinção do `usage` do chat (RN-041): zero informado pelo
    // provider não é a mesma coisa que provider calado.
    estimated: !informado,
  };
}

/**
 * `{ data: [{ embedding: number[], index }] }` — o formato da OpenAI, repetido
 * por todo compatível. `index` é o vínculo com a entrada e a doc não promete
 * ordem, então ordenar por ele é o que preserva "o i-ésimo vetor é da i-ésima
 * entrada".
 */
export function extrairVetoresOpenAI(
  provider: LLMProviderName,
  corpo: unknown,
): number[][] {
  const data = (corpo as { data?: unknown })?.data;
  if (!Array.isArray(data)) {
    throw new LLMUpstreamError(
      provider,
      'resposta de embedding sem o array `data` que a doc do /embeddings descreve',
    );
  }

  return data
    .map((linha, posicao) => ({
      indice:
        typeof (linha as { index?: unknown })?.index === 'number'
          ? (linha as { index: number }).index
          : posicao,
      vetor: exigirVetor(
        provider,
        (linha as { embedding?: unknown })?.embedding,
      ),
    }))
    .sort((a, b) => a.indice - b.indice)
    .map(({ vetor }) => vetor);
}

/** `{ embeddings: number[][] }` — o formato do `/api/embed` do Ollama. */
export function extrairVetoresOllama(
  provider: LLMProviderName,
  corpo: unknown,
): number[][] {
  const embeddings = (corpo as { embeddings?: unknown })?.embeddings;
  if (!Array.isArray(embeddings)) {
    throw new LLMUpstreamError(
      provider,
      'resposta de embedding sem o array `embeddings` que a doc do /api/embed descreve',
    );
  }
  return embeddings.map((vetor) => exigirVetor(provider, vetor));
}

function exigirVetor(provider: LLMProviderName, bruto: unknown): number[] {
  if (
    !Array.isArray(bruto) ||
    bruto.some((n) => typeof n !== 'number' || !Number.isFinite(n))
  ) {
    throw new LLMUpstreamError(
      provider,
      'embedding devolveu algo que não é um vetor de números finitos',
    );
  }
  return bruto as number[];
}
