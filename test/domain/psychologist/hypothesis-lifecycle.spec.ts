import { describe, it, expect } from 'vitest';
import {
  assertHypothesisTransition,
  InvalidHypothesisTransitionError,
} from '../../../src/domain/psychologist/hypothesis-lifecycle';

describe('assertHypothesisTransition', () => {
  it('proposed -> accepted é legal', () => {
    expect(() =>
      assertHypothesisTransition('proposed', 'accepted'),
    ).not.toThrow();
  });

  it('proposed -> dismissed é legal', () => {
    expect(() =>
      assertHypothesisTransition('proposed', 'dismissed'),
    ).not.toThrow();
  });

  it('accepted -> accepted (double-accept) é ilegal', () => {
    expect(() => assertHypothesisTransition('accepted', 'accepted')).toThrow(
      InvalidHypothesisTransitionError,
    );
  });

  it('accepted -> dismissed é ilegal (hipótese já decidida é terminal)', () => {
    expect(() => assertHypothesisTransition('accepted', 'dismissed')).toThrow(
      InvalidHypothesisTransitionError,
    );
  });

  it('dismissed -> accepted é ilegal', () => {
    expect(() => assertHypothesisTransition('dismissed', 'accepted')).toThrow(
      InvalidHypothesisTransitionError,
    );
  });
});
