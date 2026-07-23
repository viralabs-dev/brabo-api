import { describe, it, expect } from 'vitest';
import { calculateCostMicros } from '../../../src/domain/llm/cost-calculator';

describe('calculateCostMicros', () => {
  it('caminho feliz: calcula custo de entrada+saída em micro-USD', () => {
    // 1M tokens de entrada a 3_000_000 micros/1M = 3_000_000 micros
    // 500k tokens de saída a 15_000_000 micros/1M = 7_500_000 micros
    const cost = calculateCostMicros(1_000_000, 500_000, 3_000_000, 15_000_000);
    expect(cost).toBe(3_000_000 + 7_500_000);
  });

  it('zero tokens custa zero, mesmo com preço não-zero', () => {
    expect(calculateCostMicros(0, 0, 3_000_000, 15_000_000)).toBe(0);
  });

  it('modelo local (preço zero) sempre custa zero', () => {
    expect(calculateCostMicros(123_456, 654_321, 0, 0)).toBe(0);
  });

  it('arredonda pra inteiro em divisões não exatas', () => {
    const cost = calculateCostMicros(7, 0, 1_000_000, 0);
    expect(Number.isInteger(cost)).toBe(true);
    expect(cost).toBe(7); // 7 * 1_000_000 / 1_000_000 = 7
  });
});
