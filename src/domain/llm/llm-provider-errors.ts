import type { LLMErrorCode, LLMProviderName } from '@brabo/shared';

/**
 * Erros normalizados de provider de LLM (Fase 9a — ver docs/adr/0041).
 *
 * ## Por que uma classe-base aqui, e não avulsas como em git-errors.ts
 *
 * O lado git dispensou base comum porque cada erro vira um status HTTP
 * diferente num filtro. Aqui o destino é outro: o erro NÃO vira exceção HTTP —
 * ele é convertido em `ChatErrorChunk` e segue no stream, porque o turno já
 * gastou tokens e o metering precisa acontecer mesmo na falha. Quem converte
 * precisa de um único ponto que sempre expõe `code` e `message`, e é isso que
 * a base garante: nenhum provider consegue emitir erro sem classificar.
 */
export abstract class LLMProviderError extends Error {
  abstract readonly code: LLMErrorCode;

  constructor(
    readonly provider: LLMProviderName,
    message: string,
    /** Erro original do transporte/SDK — para log, nunca para o usuário. */
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class LLMAuthError extends LLMProviderError {
  readonly code = 'auth' as const;
}

export class LLMRateLimitError extends LLMProviderError {
  readonly code = 'rate_limit' as const;
}

export class LLMModelNotFoundError extends LLMProviderError {
  readonly code = 'model_not_found' as const;
}

export class LLMContextLengthExceededError extends LLMProviderError {
  readonly code = 'context_length' as const;
}

export class LLMTimeoutError extends LLMProviderError {
  readonly code = 'timeout' as const;
}

export class LLMConnectionError extends LLMProviderError {
  readonly code = 'connection' as const;
}

export class LLMUpstreamError extends LLMProviderError {
  readonly code = 'upstream' as const;
}

/**
 * O corpo de um 400 costuma ser o único lugar onde "o prompt não cabe" se
 * distingue de "o pedido está malformado". A OpenAI usa
 * `code: "context_length_exceeded"`; os clones compatíveis repetem a expressão
 * em prosa. Casar por marcador é frágil por natureza — por isso o 413 (que é
 * inequívoco) vem antes, e um 400 sem marcador cai em `upstream` em vez de
 * mentir sobre a causa.
 */
const MARCADORES_DE_CONTEXTO = [
  'context_length_exceeded',
  'context length exceeded',
  'maximum context length',
  'too many tokens',
];

/**
 * Traduz o status HTTP do provider (e o corpo, quando o status sozinho é
 * ambíguo) na classe de erro correspondente.
 */
export function normalizeHttpStatus(
  provider: LLMProviderName,
  status: number,
  body?: string,
): LLMProviderError {
  const detalhe = resumo(body);
  const sufixo = detalhe ? `: ${detalhe}` : '';

  if (status === 401 || status === 403) {
    return new LLMAuthError(
      provider,
      `credencial rejeitada por ${provider} (${status})${sufixo}`,
    );
  }
  if (status === 404) {
    return new LLMModelNotFoundError(
      provider,
      `modelo não encontrado em ${provider} (404)${sufixo}`,
    );
  }
  if (status === 429) {
    return new LLMRateLimitError(
      provider,
      `limite de uso atingido em ${provider} (429)${sufixo}`,
    );
  }
  if (status === 413 || (status === 400 && pareceContexto(body))) {
    return new LLMContextLengthExceededError(
      provider,
      `contexto excedido em ${provider} (${status})${sufixo}`,
    );
  }
  return new LLMUpstreamError(
    provider,
    `${provider} respondeu com status ${status}${sufixo}`,
  );
}

function pareceContexto(body: string | undefined): boolean {
  if (!body) return false;
  const minusculo = body.toLowerCase();
  return MARCADORES_DE_CONTEXTO.some((marcador) =>
    minusculo.includes(marcador),
  );
}

/**
 * O corpo de erro vai junto da mensagem porque sem ele "429" não diz se o
 * problema é por minuto ou por dia — mas ele é truncado: alguns providers
 * devolvem uma página HTML inteira, e isso acabaria num evento de sessão.
 */
const LIMITE_DO_DETALHE = 200;

function resumo(body: string | undefined): string {
  if (!body) return '';
  const limpo = body.replace(/\s+/g, ' ').trim();
  if (limpo.length <= LIMITE_DO_DETALHE) return limpo;
  return `${limpo.slice(0, LIMITE_DO_DETALHE)}…`;
}
