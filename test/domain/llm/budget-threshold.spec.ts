import { describe, it, expect } from 'vitest';
import {
  crossedThresholds,
  isBlocked,
} from '../../../src/domain/llm/budget-threshold';

describe('crossedThresholds', () => {
  it('caminho feliz: cruza 70% sozinho', () => {
    expect(crossedThresholds(700, 1000, 0)).toEqual([70]);
  });

  it('pula direto de 0% pra 100% e retorna os três thresholds', () => {
    expect(crossedThresholds(1000, 1000, 0)).toEqual([70, 90, 100]);
  });

  it('não re-dispara thresholds já notificados', () => {
    expect(crossedThresholds(1000, 1000, 100)).toEqual([]);
    expect(crossedThresholds(950, 1000, 70)).toEqual([90]);
  });

  it('sem limite configurado (0), nunca cruza nada', () => {
    expect(crossedThresholds(1000, 0, 0)).toEqual([]);
  });
});

describe('isBlocked', () => {
  it('caminho feliz: policy block recusa a partir de 100% do limite', () => {
    expect(isBlocked(1000, 1000, 'block')).toBe(true);
    expect(isBlocked(1200, 1000, 'block')).toBe(true);
    expect(isBlocked(999, 1000, 'block')).toBe(false);
  });

  it('policy allow nunca bloqueia, mesmo muito acima do limite', () => {
    expect(isBlocked(10_000, 1000, 'allow')).toBe(false);
  });
});
