import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canTransition,
  InvalidContainerTransitionError,
} from '../../../src/domain/containers/container-lifecycle';

describe('container-lifecycle', () => {
  describe('caminho feliz', () => {
    it('permite provisioning -> running -> stopped -> running', () => {
      expect(() => assertTransition('provisioning', 'running')).not.toThrow();
      expect(() => assertTransition('running', 'stopped')).not.toThrow();
      expect(() => assertTransition('stopped', 'running')).not.toThrow();
    });

    it('removed só sai reprovisionando (removed -> provisioning)', () => {
      expect(canTransition('removed', 'provisioning')).toBe(true);
      expect(() => assertTransition('removed', 'provisioning')).not.toThrow();
    });

    it('falha permite tentar de novo (failed -> provisioning) ou limpar (failed -> removed)', () => {
      expect(canTransition('failed', 'provisioning')).toBe(true);
      expect(canTransition('failed', 'removed')).toBe(true);
    });
  });

  describe('transições inválidas', () => {
    it('rejeita provisioning -> stopped (precisa passar por running)', () => {
      expect(canTransition('provisioning', 'stopped')).toBe(false);
      expect(() => assertTransition('provisioning', 'stopped')).toThrow(
        InvalidContainerTransitionError,
      );
    });

    it('rejeita running -> provisioning (não reprovisiona por cima do que já roda)', () => {
      expect(() => assertTransition('running', 'provisioning')).toThrow(
        InvalidContainerTransitionError,
      );
    });

    it('rejeita qualquer transição para fora de removed além de provisioning', () => {
      expect(canTransition('removed', 'running')).toBe(false);
      expect(canTransition('removed', 'stopped')).toBe(false);
      expect(canTransition('removed', 'failed')).toBe(false);
      expect(() => assertTransition('removed', 'running')).toThrow(
        InvalidContainerTransitionError,
      );
    });

    it('o erro carrega o "de" e o "para" para diagnóstico', () => {
      try {
        assertTransition('running', 'provisioning');
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(InvalidContainerTransitionError);
        const erro = e as InvalidContainerTransitionError;
        expect(erro.from).toBe('running');
        expect(erro.to).toBe('provisioning');
      }
    });
  });
});
