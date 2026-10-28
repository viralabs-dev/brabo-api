import { describe, expect, it } from 'vitest';
import {
  devoRetentarSemRaciocinio,
  opcoesDeRaciocinio,
} from '../../../src/domain/llm/raciocinio-do-agente';

describe('opcoesDeRaciocinio (RN-782/783)', () => {
  it('dev agent de execução com modelo que raciocina: desligado explícito', () => {
    expect(opcoesDeRaciocinio(true, 'dev-backend')).toEqual({
      reasoning: true,
      reasoningOff: true,
    });
  });

  it('conversacional (criativo) e Dev Lead: só a folga, sem desligar', () => {
    expect(opcoesDeRaciocinio(true, 'criativo')).toEqual({ reasoning: true });
    expect(opcoesDeRaciocinio(true, 'dev-lead')).toEqual({ reasoning: true });
    expect(opcoesDeRaciocinio(true, undefined)).toEqual({ reasoning: true });
  });

  it('orçamento provado do modelo entra; dev agent e modelo sem raciocínio não (RN-914)', () => {
    expect(opcoesDeRaciocinio(true, 'po', 2048)).toEqual({
      reasoning: true,
      reasoningBudget: 2048,
    });
    expect(opcoesDeRaciocinio(true, 'po', null)).toEqual({ reasoning: true });
    expect(opcoesDeRaciocinio(true, 'dev-backend', 2048)).toEqual({
      reasoning: true,
      reasoningOff: true,
    });
    expect(opcoesDeRaciocinio(false, 'po', 2048)).toEqual({});
  });

  it('falha: modelo sem supportsReasoning não manda nada, nem para dev-*', () => {
    expect(opcoesDeRaciocinio(false, 'dev-backend')).toEqual({});
    expect(opcoesDeRaciocinio(false, 'criativo')).toEqual({});
  });

  it('QA de Automação desliga; QA-estratégia e outros gates não (RN-838)', () => {
    expect(opcoesDeRaciocinio(true, 'qa-automacao')).toEqual({
      reasoning: true,
      reasoningOff: true,
    });
    expect(opcoesDeRaciocinio(true, 'qa-estrategia')).toEqual({
      reasoning: true,
    });
    expect(opcoesDeRaciocinio(true, 'qa-performance-seguranca')).toEqual({
      reasoning: true,
    });
  });

  it('falha: QA de Automação com modelo sem supportsReasoning não manda nada', () => {
    expect(opcoesDeRaciocinio(false, 'qa-automacao')).toEqual({});
  });
});

describe('devoRetentarSemRaciocinio (AT-587, RN-916)', () => {
  const base = {
    opcoes: { reasoning: true as const },
    aceitaRaciocinioDesligado: true,
    truncated: true,
    texto: '',
    toolCalls: 0,
    abortado: false,
    reasoningTokens: 4096,
  };

  it('truncada, vazia e com o raciocínio no orçamento: retenta', () => {
    expect(devoRetentarSemRaciocinio(base)).toBe(true);
    // folga: 3840 = 4096 - 256 ainda conta; 3839 não
    expect(devoRetentarSemRaciocinio({ ...base, reasoningTokens: 3840 })).toBe(
      true,
    );
    expect(devoRetentarSemRaciocinio({ ...base, reasoningTokens: 3839 })).toBe(
      false,
    );
  });

  it('o orçamento do modelo vale no lugar do padrão; o aborto da RN-915 retenta', () => {
    const opcoes = { reasoning: true as const, reasoningBudget: 2048 };
    expect(
      devoRetentarSemRaciocinio({ ...base, opcoes, reasoningTokens: 1800 }),
    ).toBe(true);
    expect(
      devoRetentarSemRaciocinio({
        ...base,
        reasoningTokens: null,
        abortado: true,
      }),
    ).toBe(true);
  });

  it('falha: com texto, com tool call, sem corte, sem aceite ou já desligado, não retenta', () => {
    expect(devoRetentarSemRaciocinio({ ...base, texto: 'x' })).toBe(false);
    expect(devoRetentarSemRaciocinio({ ...base, toolCalls: 1 })).toBe(false);
    expect(devoRetentarSemRaciocinio({ ...base, truncated: false })).toBe(
      false,
    );
    expect(
      devoRetentarSemRaciocinio({ ...base, aceitaRaciocinioDesligado: false }),
    ).toBe(false);
    expect(
      devoRetentarSemRaciocinio({
        ...base,
        opcoes: { reasoning: true, reasoningOff: true },
      }),
    ).toBe(false);
    expect(devoRetentarSemRaciocinio({ ...base, opcoes: {} })).toBe(false);
  });
});
