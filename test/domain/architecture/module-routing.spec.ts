import { describe, expect, it } from 'vitest';
import {
  RoteamentoInvalidoError,
  validarRoteamento,
} from '../../../src/domain/architecture/module-routing';

const IMAGEM = 'node:22-bookworm-slim';
const PORQUE = 'módulo TypeScript sobre Node 22 — só o runtime';

describe('validarRoteamento', () => {
  it('caminho feliz: normaliza um item por módulo', () => {
    const roteamento = validarRoteamento([
      { modulo: 'api', imagemCandidata: IMAGEM, porque: PORQUE },
      { modulo: 'web', imagemCandidata: IMAGEM, porque: PORQUE },
    ]);

    expect(roteamento).toEqual([
      { modulo: 'api', imagemCandidata: IMAGEM, porque: PORQUE },
      { modulo: 'web', imagemCandidata: IMAGEM, porque: PORQUE },
    ]);
  });

  it('lista vazia é recusada — não é uma decisão', () => {
    expect(() => validarRoteamento([])).toThrow(RoteamentoInvalidoError);
  });

  it('item sem `modulo` é recusado', () => {
    expect(() =>
      validarRoteamento([{ imagemCandidata: IMAGEM, porque: PORQUE }]),
    ).toThrow(RoteamentoInvalidoError);
  });

  it('módulo repetido é recusado — cada módulo recebe UM roteamento', () => {
    expect(() =>
      validarRoteamento([
        { modulo: 'api', imagemCandidata: IMAGEM, porque: PORQUE },
        { modulo: 'api', imagemCandidata: 'python:3.12-slim', porque: PORQUE },
      ]),
    ).toThrow(/mais de uma vez/);
  });

  it('imagem `latest` é recusada — delegado a validarDecisaoDeImagem, com o módulo na mensagem', () => {
    expect(() =>
      validarRoteamento([
        { modulo: 'api', imagemCandidata: 'node:latest', porque: PORQUE },
      ]),
    ).toThrow(/"api"/);
  });

  it('rationale curto é recusado — delegado a validarDecisaoDeImagem', () => {
    expect(() =>
      validarRoteamento([
        { modulo: 'api', imagemCandidata: IMAGEM, porque: 'curto' },
      ]),
    ).toThrow(RoteamentoInvalidoError);
  });
});
