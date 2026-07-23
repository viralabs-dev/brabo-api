import { describe, it, expect } from 'vitest';
import {
  assertTransition,
  canTransition,
  InvalidActionTransitionError,
  isTerminal,
} from '../../../src/domain/actions/action-state-machine';

describe('action-state-machine', () => {
  describe('caminho feliz', () => {
    it('permite pending -> approved', () => {
      expect(() => assertTransition('pending', 'approved')).not.toThrow();
    });

    it('permite pending -> denied', () => {
      expect(() => assertTransition('pending', 'denied')).not.toThrow();
    });

    it('permite approved -> executed e approved -> failed', () => {
      expect(() => assertTransition('approved', 'executed')).not.toThrow();
      expect(() => assertTransition('approved', 'failed')).not.toThrow();
    });

    it('permite auto_approved -> executed e auto_approved -> failed', () => {
      expect(() => assertTransition('auto_approved', 'executed')).not.toThrow();
      expect(() => assertTransition('auto_approved', 'failed')).not.toThrow();
    });
  });

  describe('transições inválidas', () => {
    it('auto_approved nunca é destino válido de uma transição, de nenhum estado', () => {
      for (const from of [
        'pending',
        'approved',
        'denied',
        'auto_approved',
        'executed',
        'failed',
      ] as const) {
        expect(canTransition(from, 'auto_approved')).toBe(false);
        expect(() => assertTransition(from, 'auto_approved')).toThrow(
          InvalidActionTransitionError,
        );
      }
    });

    it('rejeita qualquer transição para fora de um estado terminal', () => {
      expect(() => assertTransition('denied', 'approved')).toThrow(
        InvalidActionTransitionError,
      );
      expect(() => assertTransition('executed', 'failed')).toThrow(
        InvalidActionTransitionError,
      );
      expect(() => assertTransition('failed', 'executed')).toThrow(
        InvalidActionTransitionError,
      );
    });

    it('não permite pular direto de pending pra executed', () => {
      expect(() => assertTransition('pending', 'executed')).toThrow(
        InvalidActionTransitionError,
      );
    });
  });

  describe('isTerminal', () => {
    it('identifica denied, executed e failed como terminais', () => {
      expect(isTerminal('denied')).toBe(true);
      expect(isTerminal('executed')).toBe(true);
      expect(isTerminal('failed')).toBe(true);
    });

    it('identifica pending, approved e auto_approved como não-terminais', () => {
      expect(isTerminal('pending')).toBe(false);
      expect(isTerminal('approved')).toBe(false);
      expect(isTerminal('auto_approved')).toBe(false);
    });
  });
});
