import { describe, it, expect } from 'vitest';
import {
  classificar,
  type EstadoDoRefresh,
} from '../../../src/domain/auth/refresh-token';

const AGORA = new Date('2026-07-27T12:00:00Z');
const TETO = 30 * 24 * 60 * 60 * 1000; // 30 dias

function estado(parcial: Partial<EstadoDoRefresh> = {}): EstadoDoRefresh {
  return {
    rotatedAt: null,
    revokedAt: null,
    expiresAt: new Date('2026-08-10T12:00:00Z'),
    familyStartedAt: new Date('2026-07-26T12:00:00Z'),
    ...parcial,
  };
}

describe('classificação do refresh', () => {
  it('caminho feliz: token vivo e não gasto', () => {
    expect(classificar(estado(), AGORA, TETO)).toBe('ok');
  });

  it('linha inexistente é desconhecido', () => {
    expect(classificar(null, AGORA, TETO)).toBe('desconhecido');
  });

  it('token já rotacionado é REUSO', () => {
    expect(
      classificar(estado({ rotatedAt: new Date('2026-07-27T11:00:00Z') }), AGORA, TETO),
    ).toBe('reuso');
  });

  it('token expirado', () => {
    expect(
      classificar(estado({ expiresAt: new Date('2026-07-26T12:00:00Z') }), AGORA, TETO),
    ).toBe('expirado');
  });

  it('família que passou do teto absoluto', () => {
    // Sem esta pergunta, rotação a cada 15 min dá sessão eterna.
    expect(
      classificar(
        estado({ familyStartedAt: new Date('2026-05-01T12:00:00Z') }),
        AGORA,
        TETO,
      ),
    ).toBe('familia_expirada');
  });

  describe('a ordem das perguntas', () => {
    it('revogado vence reuso — vítima a jusante não gera novo alarme', () => {
      // Quando uma família morre por reuso, seus tokens ficam com revoked_at E
      // muitos com rotated_at. Se `reuso` viesse primeiro, cada aba do usuário
      // legítimo dispararia uma nova "detecção de roubo" e encheria o log de
      // segurança de alarme falso durante o incidente.
      expect(
        classificar(
          estado({
            revokedAt: new Date('2026-07-27T11:30:00Z'),
            rotatedAt: new Date('2026-07-27T11:00:00Z'),
          }),
          AGORA,
          TETO,
        ),
      ).toBe('revogado');
    });

    it('reuso vence expirado — token roubado e vencido ainda é evidência', () => {
      // O oposto do caso acima: aqui a cascata PRECISA rodar.
      expect(
        classificar(
          estado({
            rotatedAt: new Date('2026-07-20T12:00:00Z'),
            expiresAt: new Date('2026-07-26T12:00:00Z'),
          }),
          AGORA,
          TETO,
        ),
      ).toBe('reuso');
    });

    it('reuso vence família expirada, pela mesma razão', () => {
      expect(
        classificar(
          estado({
            rotatedAt: new Date('2026-05-02T12:00:00Z'),
            familyStartedAt: new Date('2026-05-01T12:00:00Z'),
          }),
          AGORA,
          TETO,
        ),
      ).toBe('reuso');
    });
  });

  it('expiração é no instante exato, não depois dele', () => {
    expect(classificar(estado({ expiresAt: AGORA }), AGORA, TETO)).toBe(
      'expirado',
    );
  });
});
