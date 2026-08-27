/**
 * Erros normalizados do cliente do Hugging Face Hub.
 *
 * Mesmo ESPÍRITO de `domain/llm/llm-provider-errors.ts` (timeout distinto de
 * recusa de conexão, corpo de erro resumido), mas com taxonomia PRÓPRIA em vez
 * de reaproveitar `LLMProviderError`: o Hub não é um `LLMProvider` — não
 * conversa, não é candidato a `LLMProviderRegistry` — e um `instanceof
 * LLMProviderError` em código de metering/roteamento de LLM não deveria
 * enxergar uma falha de busca no Hub. Mesmo critério de `git-errors.ts`:
 * classes avulsas, sem base comum, porque quem consome mapeia por
 * `instanceof` direto num filtro HTTP (ver `huggingface-error.filter.ts`).
 */

export class HuggingFaceConnectionError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'HuggingFaceConnectionError';
  }
}

export class HuggingFaceTimeoutError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'HuggingFaceTimeoutError';
  }
}

/** O Hub respondeu, mas com status de erro (4xx/5xx). */
export class HuggingFaceUpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HuggingFaceUpstreamError';
  }
}
