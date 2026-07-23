/**
 * Custo em micro-USD (1 USD = 1_000_000 micros) — inteiro, sem ponto
 * flutuante. Preços de entrada e saída já vêm em micro-USD por 1M
 * tokens.
 */
export function calculateCostMicros(
  inputTokens: number,
  outputTokens: number,
  inputPricePerMillionMicros: number,
  outputPricePerMillionMicros: number,
): number {
  const inputCost = Math.round(
    (inputTokens * inputPricePerMillionMicros) / 1_000_000,
  );
  const outputCost = Math.round(
    (outputTokens * outputPricePerMillionMicros) / 1_000_000,
  );
  return inputCost + outputCost;
}
