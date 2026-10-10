import { describe, expect, it } from 'vitest';
import { opcoesDeRaciocinio } from '../../../src/domain/llm/raciocinio-do-agente';

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

  it('falha: modelo sem supportsReasoning não manda nada, nem para dev-*', () => {
    expect(opcoesDeRaciocinio(false, 'dev-backend')).toEqual({});
    expect(opcoesDeRaciocinio(false, 'criativo')).toEqual({});
  });
});
