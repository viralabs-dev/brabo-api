import { describe, expect, it } from 'vitest';
import {
  formatarBytes,
  formatarIdade,
  parseArgs,
} from '../../scripts/relatorio-telemetria';

/**
 * O relatório de telemetria sob demanda (papel `platform`, `docs/fluxo.yml`).
 *
 * Só as funções PURAS: a parte que fala com o banco (`coletar`) replica as
 * mesmas consultas do `DomainGaugesCollector` e é exercitada rodando o
 * script contra um banco real — mesmo recorte de `medir-execucao.spec.ts` e
 * `validacao-gates.spec.ts`.
 */

describe('parseArgs', () => {
  it('sem argumento nenhum: relatório de TODOS os projetos', () => {
    expect(parseArgs([])).toEqual({ projeto: null, json: false });
  });

  it('`--projeto` captura o uuid seguinte', () => {
    expect(parseArgs(['--projeto', 'abc-123'])).toEqual({
      projeto: 'abc-123',
      json: false,
    });
  });

  it('`--json` liga a saída em JSON', () => {
    expect(parseArgs(['--json'])).toEqual({ projeto: null, json: true });
    expect(parseArgs(['--projeto', 'abc-123', '--json'])).toEqual({
      projeto: 'abc-123',
      json: true,
    });
  });

  /**
   * `pnpm <script> -- --flag` repassa o `--` literal — mesmo uso normal que
   * `validacao-gates.ts` já precisou tratar.
   */
  it('o `--` do pnpm é ignorado', () => {
    expect(parseArgs(['--', '--json'])).toEqual({ projeto: null, json: true });
  });

  it('`--projeto` sem valor é uso inválido', () => {
    expect(parseArgs(['--projeto'])).toEqual({
      projeto: null,
      json: false,
      erro: '--projeto exige um uuid',
    });
    expect(parseArgs(['--projeto', '--json'])).toEqual({
      projeto: null,
      json: false,
      erro: '--projeto exige um uuid',
    });
  });

  it('opção desconhecida é uso inválido, não silêncio', () => {
    expect(parseArgs(['--turbo'])).toEqual({
      projeto: null,
      json: false,
      erro: 'opção desconhecida: --turbo',
    });
  });
});

describe('formatarIdade', () => {
  it('negativo é "nunca houve backup" — mesma convenção do coletor', () => {
    expect(formatarIdade(-1)).toBe('nunca houve backup');
  });

  it('segundos', () => {
    expect(formatarIdade(12)).toBe('12s');
  });

  it('minutos', () => {
    expect(formatarIdade(41 * 60)).toBe('41m');
  });

  it('horas e minutos', () => {
    expect(formatarIdade(2 * 3600 + 15 * 60)).toBe('2h15m');
  });

  it('dias e horas', () => {
    expect(formatarIdade(25 * 3600)).toBe('1d01h');
  });
});

describe('formatarBytes', () => {
  it('zero ou negativo', () => {
    expect(formatarBytes(0)).toBe('0 B');
    expect(formatarBytes(-5)).toBe('0 B');
  });

  it('bytes puros, sem casa decimal', () => {
    expect(formatarBytes(512)).toBe('512 B');
  });

  it('sobe de unidade em potências de 1024', () => {
    expect(formatarBytes(1024)).toBe('1.0 KB');
    expect(formatarBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
