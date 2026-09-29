import { describe, expect, it } from 'vitest';
import {
  normalizarIdiomaBcp47,
  resolverIdiomaDaResposta,
  type FontesDoIdiomaDaResposta,
} from '../../../src/domain/iam/idioma-de-resposta';

/**
 * O idioma das respostas dos agentes (RN-618, ADR 0177): a régua de um
 * código aceito e a precedência entre as quatro fontes.
 */
describe('normalizarIdiomaBcp47 (RN-618) — lista aberta, mas de idiomas', () => {
  it.each([
    ['pt-BR', 'pt-BR'],
    ['pt-br', 'pt-BR'],
    ['EN', 'en'],
    ['es', 'es'],
    ['fr-CA', 'fr-CA'],
    ['zh-hant-tw', 'zh-Hant-TW'],
    ['  de  ', 'de'],
  ])('aceita %j e grava a forma canônica %j', (entrada, esperado) => {
    expect(normalizarIdiomaBcp47(entrada)).toBe(esperado);
  });

  it.each([
    ['vazio', ''],
    ['só espaço', '   '],
    ['forma inválida', 'en_US'],
    ['forma BCP-47 de idioma que não existe', 'zz'],
    ['três letras que não são idioma', 'abc'],
    ['indeterminado', 'und'],
    ['uso privado', 'x-klingon'],
    ['texto livre', 'português'],
    ['acima do teto de 35', `en-${'a'.repeat(40)}`],
  ])('recusa %s (%j)', (_nome, entrada) => {
    expect(normalizarIdiomaBcp47(entrada)).toBeNull();
  });
});

describe('resolverIdiomaDaResposta (RN-618) — sessão > conta > detectado > interface', () => {
  const nada: FontesDoIdiomaDaResposta = {
    sessao: null,
    conta: null,
    detectadoConfirmado: null,
    interface: 'pt-BR',
  };

  it('sem nada escolhido nem detectado, vale o idioma da INTERFACE — a cadeia sempre termina num idioma', () => {
    expect(resolverIdiomaDaResposta(nada)).toEqual({
      idioma: 'pt-BR',
      origem: 'interface',
    });
  });

  it('o detectado CONFIRMADO vence a interface', () => {
    expect(
      resolverIdiomaDaResposta({ ...nada, detectadoConfirmado: 'en' }),
    ).toEqual({ idioma: 'en', origem: 'detectado' });
  });

  it('a escolha da CONTA vence o detectado — a detecção não troca a escolha', () => {
    expect(
      resolverIdiomaDaResposta({
        ...nada,
        conta: 'es',
        detectadoConfirmado: 'en',
      }),
    ).toEqual({ idioma: 'es', origem: 'conta' });
  });

  it('o override da SESSÃO vence tudo', () => {
    expect(
      resolverIdiomaDaResposta({
        sessao: 'fr',
        conta: 'es',
        detectadoConfirmado: 'en',
        interface: 'pt-BR',
      }),
    ).toEqual({ idioma: 'fr', origem: 'sessao' });
  });
});
