import { describe, expect, it } from 'vitest';
import {
  DOMINIOS_DA_FONTE,
  PRECOS_DO_FABRICANTE,
} from '../../../src/domain/llm/precos-do-fabricante';

describe('tabela de preços do fabricante', () => {
  it('não repete id em duas linhas', () => {
    const ids = PRECOS_DO_FABRICANTE.flatMap((p) => p.ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('data bem formada e não futura, preço inteiro não negativo, fonte no domínio do fabricante', () => {
    const hoje = new Date().toISOString().slice(0, 10);
    for (const p of PRECOS_DO_FABRICANTE) {
      expect(p.conferidoEm).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.conferidoEm <= hoje).toBe(true);
      for (const n of [p.entradaMicros, p.saidaMicros]) {
        expect(Number.isInteger(n) && n >= 0).toBe(true);
      }
      const url = new URL(p.fonte);
      expect(url.protocol).toBe('https:');
      const ok = (DOMINIOS_DA_FONTE[p.fabricante] ?? []).some(
        (d) => url.hostname === d || url.hostname.endsWith(`.${d}`),
      );
      expect(ok).toBe(true);
    }
  });
});
