import { describe, it, expect } from 'vitest';
import {
  assertReopen,
  assertTransition,
  canReopen,
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

    it('rejeita qualquer transição GENÉRICA para fora de um estado terminal (a reabertura é caminho próprio, ADR 0183)', () => {
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

  describe('reabertura (ADR 0183, RN-649)', () => {
    it('só os terminais reabrem, e para active', () => {
      expect(canReopen('closed')).toBe(true);
      expect(canReopen('closed_abnormally')).toBe(true);
      expect(() => assertReopen('closed')).not.toThrow();
      expect(() => assertReopen('closed_abnormally')).not.toThrow();
    });

    it('closing NUNCA volta a active, nem pela reabertura', () => {
      expect(canReopen('closing')).toBe(false);
      expect(() => assertReopen('closing')).toThrow(
        InvalidSessionTransitionError,
      );
    });

    it('sessão viva não "reabre"', () => {
      expect(canReopen('created')).toBe(false);
      expect(canReopen('active')).toBe(false);
      expect(() => assertReopen('active')).toThrow(
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
