import { describe, it, expect } from 'vitest';
import {
  bloqueadoAte,
  EscadaInvalidaError,
  ESCADA_PADRAO,
  lerEscada,
  segundosDeBloqueio,
} from '../../../src/domain/auth/lockout-policy';

describe('escada do lockout', () => {
  it('caminho feliz: abaixo do primeiro degrau não bloqueia', () => {
    expect(segundosDeBloqueio(4)).toBe(0);
  });

  it('escala pelos degraus', () => {
    expect(segundosDeBloqueio(5)).toBe(30);
    expect(segundosDeBloqueio(7)).toBe(30);
    expect(segundosDeBloqueio(8)).toBe(300);
    expect(segundosDeBloqueio(11)).toBe(300);
    expect(segundosDeBloqueio(12)).toBe(900);
  });

  it('acima do último degrau fica no teto, não zera', () => {
    // O erro clássico é procurar o degrau exato e não achar nenhum para 500
    // falhas — devolvendo 0 justamente para quem mais está atacando.
    expect(segundosDeBloqueio(500)).toBe(900);
  });

  it('vale o MAIOR degrau alcançado, não o primeiro que casa', () => {
    // Parar no primeiro faria a escada nunca escalar: dez falhas dariam 30s.
    expect(segundosDeBloqueio(10)).toBe(300);
  });

  it('o teto da escada é igual à janela padrão', () => {
    // Invariante deliberada: teto MAIOR que a janela exigiria um
    // `locked_until` persistente, porque a janela deslizante não consegue
    // representar um bloqueio mais longo do que ela mesma. Se alguém aumentar
    // um sem o outro, este teste é onde a conversa acontece.
    const teto = ESCADA_PADRAO[ESCADA_PADRAO.length - 1].segundos;
    expect(teto * 1000).toBe(900_000);
  });
});

describe('bloqueadoAte', () => {
  const ultima = new Date('2026-07-27T12:00:00Z');

  it('devolve null quando não há falha nenhuma', () => {
    expect(bloqueadoAte(0, null)).toBeNull();
  });

  it('devolve null abaixo do primeiro degrau', () => {
    expect(bloqueadoAte(4, ultima)).toBeNull();
  });

  it('conta a partir da ÚLTIMA falha, não da primeira', () => {
    // Contar da primeira faria o bloqueio expirar enquanto o atacante ainda
    // está tentando — a janela avança com ele.
    expect(bloqueadoAte(5, ultima)).toEqual(
      new Date('2026-07-27T12:00:30Z'),
    );
  });
});

describe('lerEscada', () => {
  it('caminho feliz: lê o formato falhas:segundos', () => {
    expect(lerEscada('3:10,6:60')).toEqual([
      { falhas: 3, segundos: 10 },
      { falhas: 6, segundos: 60 },
    ]);
  });

  it('vazio ou ausente cai no padrão', () => {
    expect(lerEscada(undefined)).toEqual(ESCADA_PADRAO);
    expect(lerEscada('   ')).toEqual(ESCADA_PADRAO);
  });

  it('recusa degraus fora de ordem', () => {
    // Aceitar isto não daria erro visível: daria um lockout que não bloqueia,
    // e o sintoma seria silêncio até alguém ser atacado.
    expect(() => lerEscada('8:300,5:30')).toThrow(EscadaInvalidaError);
  });

  it('recusa duração que diminui conforme as falhas aumentam', () => {
    expect(() => lerEscada('5:300,8:30')).toThrow(EscadaInvalidaError);
  });

  it('recusa número inválido', () => {
    expect(() => lerEscada('cinco:30')).toThrow(EscadaInvalidaError);
    expect(() => lerEscada('5:zero')).toThrow(EscadaInvalidaError);
    expect(() => lerEscada('0:30')).toThrow(EscadaInvalidaError);
  });
});
