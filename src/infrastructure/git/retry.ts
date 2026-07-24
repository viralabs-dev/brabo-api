// Retry com backoff exponencial + jitter — só pra operações IDEMPOTENTES
// de leitura (getRepo/listBranches nos providers remotos). Mutações
// nunca passam por aqui: se uma chamada mutante falhar, o erro sobe cru
// e quem chamou decide o que fazer — nunca reexecutamos uma escrita
// automaticamente. Ver docs/adr/0003-git-provider-retry-policy.md.

export interface RetryOptions {
  /** Tentativas totais, incluindo a primeira. */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Decide se um erro específico deve ser retentado — default: sempre. */
  shouldRetry?: (error: unknown) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 4,
    baseDelayMs = 250,
    maxDelayMs = 4000,
    shouldRetry = () => true,
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1 || !shouldRetry(error)) throw error;
      // "Full Jitter" (AWS) — sleep = random(0, min(maxDelay, base*2^tentativa)).
      const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      await delay(Math.random() * cap);
    }
  }
  throw lastError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
