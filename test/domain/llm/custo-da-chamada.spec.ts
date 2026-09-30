import { describe, expect, it } from 'vitest';
import { custoDaChamada } from '../../../src/domain/llm/custo-da-chamada';
import { precoImplicitoPorMilhao } from '../../../src/domain/llm/tool-router';
import { calculateCostMicros } from '../../../src/domain/llm/cost-calculator';

// Preço de catálogo do modelo do uso real de 29/09 (micros por milhão).
const CATALOGO = {
  inputPricePerMillionMicros: 20_000,
  outputPricePerMillionMicros: 600_000,
};

describe('custoDaChamada (ADR 0188, RN-665)', () => {
  it('custo real presente: ele é o número, o preço é implícito e o do catálogo vai ao lado', () => {
    const c = custoDaChamada({
      inputTokens: 6_079_639,
      outputTokens: 321_106,
      custoRealMicros: 580_700,
      ...CATALOGO,
    });

    expect(c.costMicros).toBe(580_700);
    expect(c.priceImplicit).toBe(true);
    // O uso real de 29/09 repreçado pelo catálogo (a análise somou por linha:
    // US$ 0,314259; numa linha só, o arredondamento dá 314 257).
    expect(c.catalogCostMicros).toBe(314_257);
    expect(c.inputPricePerMillionMicros).toBe(90_724);
    expect(c.outputPricePerMillionMicros).toBe(90_724);
    // `tokens × preço = custo` (RN-044) continua reproduzível, a menos do
    // arredondamento do preço inteiro por milhão.
    const refeito = calculateCostMicros(
      6_079_639,
      321_106,
      c.inputPricePerMillionMicros,
      c.outputPricePerMillionMicros,
    );
    expect(Math.abs(refeito - c.costMicros)).toBeLessThanOrEqual(4);
  });

  it('custo real ZERO é custo real (modelo gratuito), não ausência', () => {
    const c = custoDaChamada({
      inputTokens: 100,
      outputTokens: 10,
      custoRealMicros: 0,
      ...CATALOGO,
    });
    expect(c).toMatchObject({
      costMicros: 0,
      priceImplicit: true,
      inputPricePerMillionMicros: 0,
      catalogCostMicros: 8,
    });
  });

  it.each([null, undefined])(
    'sem custo real (%s): o catálogo continua, como no ADR 0042',
    (ausente) => {
      const c = custoDaChamada({
        inputTokens: 10_000,
        outputTokens: 500,
        custoRealMicros: ausente,
        ...CATALOGO,
      });
      expect(c).toEqual({
        costMicros: 500,
        ...CATALOGO,
        priceImplicit: false,
        catalogCostMicros: null,
      });
    },
  );

  it('preço implícito sem tokens é 0, nunca divisão por zero', () => {
    expect(precoImplicitoPorMilhao(1_000, 0)).toBe(0);
    expect(precoImplicitoPorMilhao(1_850, 10_500)).toBe(176_190);
  });
});
