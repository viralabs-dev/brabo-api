import { describe, it, expect } from 'vitest';
import {
  assertTransition,
  canTransition,
  InvalidSessionTransitionError,
  isTerminal,
} from '../../../src/domain/sessions/session-state-machine';

describe('session-state-machine', () => {
  describe('caminho feliz', () => {
    it('permite created -> active -> closing -> closed', () => {
      expect(() => assertTransition('created', 'active')).not.toThrow();
      expect(() => assertTransition('active', 'closing')).not.toThrow();
      expect(() => assertTransition('closing', 'closed')).not.toThrow();
    });

    it('permite encerramento abrupto a partir de qualquer estado não-terminal', () => {
      expect(canTransition('created', 'closed_abnormally')).toBe(true);
      expect(canTransition('active', 'closed_abnormally')).toBe(true);
      expect(canTransition('closing', 'closed_abnormally')).toBe(true);
    });
  });

  describe('transições inválidas', () => {
    it('rejeita created -> closing (precisa passar por active)', () => {
      expect(canTransition('created', 'closing')).toBe(false);
      expect(() => assertTransition('created', 'closing')).toThrow(
        InvalidSessionTransitionError,
      );
    });

    it('rejeita created -> closed diretamente', () => {
      expect(() => assertTransition('created', 'closed')).toThrow(
        InvalidSessionTransitionError,
      );
    });

    it('rejeita qualquer transição para fora de um estado terminal', () => {
      expect(() => assertTransition('closed', 'active')).toThrow(
        InvalidSessionTransitionError,
      );
      expect(() => assertTransition('closed_abnormally', 'active')).toThrow(
        InvalidSessionTransitionError,
      );
    });

    it('rejeita closing voltar para active', () => {
      expect(() => assertTransition('closing', 'active')).toThrow(
        InvalidSessionTransitionError,
      );
    });
  });

  describe('isTerminal', () => {
    it('identifica closed e closed_abnormally como terminais', () => {
      expect(isTerminal('closed')).toBe(true);
      expect(isTerminal('closed_abnormally')).toBe(true);
      expect(isTerminal('created')).toBe(false);
      expect(isTerminal('active')).toBe(false);
      expect(isTerminal('closing')).toBe(false);
    });
  });
});
