import { calculateCostMicros } from './cost-calculator';
// A MESMA fórmula do Jev (ADR 0179): `custo ÷ tokens`, o mesmo valor nas duas
// colunas — o provider devolve UM custo, e dividi-lo entre entrada e saída
// seria inventar a proporção. Uma função só, para as duas linhas concordarem.
import { precoImplicitoPorMilhao } from './tool-router';

/**
 * O custo que o metering GRAVA para uma chamada de LLM (ADR 0188, RN-665).
 *
 * Duas fontes, e uma regra só de precedência — a do dono (30/09): **o custo
 * real vira o número**. Quando o provider devolveu o que cobrou (`usage.cost`
 * no OpenRouter), é ele o `costMicros`; o preço do catálogo (ADR 0042) fica só
 * para quando a resposta não disse.
 *
 * Com custo real, o preço por milhão da linha é IMPLÍCITO (`custo ÷ tokens`),
 * marcado por `priceImplicit` — a MESMA coluna que o ADR 0179 usou para o
 * Jev —, e é isso que mantém `tokens × preço = custo` (RN-044) sem fingir um
 * preço de tabela que não produziu o número. O preço de catálogo não some: o
 * que ELE teria cobrado vai em `catalogCostMicros`, ao lado, e é por ele que se
 * mede a distância entre a estimativa e a fatura (a análise de uso real de
 * 29/09 mediu 1,85×).
 */
export interface CustoDaChamadaInput {
  inputTokens: number;
  outputTokens: number;
  /** O custo que a resposta disse, em micro-USD; `undefined`/`null` = não disse. */
  custoRealMicros: number | null | undefined;
  /** O preço de catálogo vigente no instante da chamada (RN-044). */
  inputPricePerMillionMicros: number;
  outputPricePerMillionMicros: number;
}

export interface CustoDaChamada {
  costMicros: number;
  inputPricePerMillionMicros: number;
  outputPricePerMillionMicros: number;
  /** `true` = o preço acima foi derivado do custo real, não veio do catálogo. */
  priceImplicit: boolean;
  /** O que o CATÁLOGO teria cobrado — só quando `costMicros` é o real. */
  catalogCostMicros: number | null;
}

export function custoDaChamada(input: CustoDaChamadaInput): CustoDaChamada {
  const peloCatalogo = calculateCostMicros(
    input.inputTokens,
    input.outputTokens,
    input.inputPricePerMillionMicros,
    input.outputPricePerMillionMicros,
  );
  const real = input.custoRealMicros;
  if (real === null || real === undefined) {
    return {
      costMicros: peloCatalogo,
      inputPricePerMillionMicros: input.inputPricePerMillionMicros,
      outputPricePerMillionMicros: input.outputPricePerMillionMicros,
      priceImplicit: false,
      catalogCostMicros: null,
    };
  }
  const preco = precoImplicitoPorMilhao(
    real,
    input.inputTokens + input.outputTokens,
  );
  return {
    costMicros: real,
    inputPricePerMillionMicros: preco,
    outputPricePerMillionMicros: preco,
    priceImplicit: true,
    catalogCostMicros: peloCatalogo,
  };
}
