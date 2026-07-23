import { describe, it, expect } from 'vitest';
import {
  assertTransition,
  canTransition,
  InvalidActionTransitionError,
  isTerminal,
} from '../../../src/domain/actions/action-state-machine';

describe('action-state-machine', () => {
  describe('caminho feliz', () => {
    it('permite proposed -> approved', () => {
      expect(() => assertTransition('proposed', 'approved')).not.toThrow();
    });

    it('permite proposed -> rejected', () => {
      expect(() => assertTransition('proposed', 'rejected')).not.toThrow();
    });
  });

  describe('transições inválidas', () => {
    it('auto_approved nunca é destino válido de uma transição, de nenhum estado', () => {
      for (const from of [
        'proposed',
        'approved',
        'rejected',
        'auto_approved',
      ] as const) {
        expect(canTransition(from, 'auto_approved')).toBe(false);
        expect(() => assertTransition(from, 'auto_approved')).toThrow(
          InvalidActionTransitionError,
        );
      }
    });

    it('rejeita qualquer transição para fora de um estado terminal', () => {
      expect(() => assertTransition('approved', 'rejected')).toThrow(
        InvalidActionTransitionError,
      );
      expect(() => assertTransition('rejected', 'approved')).toThrow(
        InvalidActionTransitionError,
      );
      expect(() => assertTransition('auto_approved', 'approved')).toThrow(
        InvalidActionTransitionError,
      );
    });
  });

  describe('isTerminal', () => {
    it('identifica approved, rejected e auto_approved como terminais', () => {
      expect(isTerminal('approved')).toBe(true);
      expect(isTerminal('rejected')).toBe(true);
      expect(isTerminal('auto_approved')).toBe(true);
      expect(isTerminal('proposed')).toBe(false);
    });
  });
});
