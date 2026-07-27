import { describe, it, expect } from 'vitest';
import {
  canTransition,
  assertTransition,
  InvalidStoryTransitionError,
} from '../../../src/domain/backlog/story-state-machine';

describe('story-state-machine', () => {
  it('permite o fluxo feliz draft→ready→in_progress→done', () => {
    expect(canTransition('draft', 'ready')).toBe(true);
    expect(canTransition('ready', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'done')).toBe(true);
  });

  it('done é terminal', () => {
    expect(canTransition('done', 'in_progress')).toBe(false);
    expect(() => assertTransition('done', 'ready')).toThrow(
      InvalidStoryTransitionError,
    );
  });

  it('não pula de draft direto pra in_progress', () => {
    expect(canTransition('draft', 'in_progress')).toBe(false);
  });

  it('permite retrabalho (ready→draft, in_progress→ready)', () => {
    expect(canTransition('ready', 'draft')).toBe(true);
    expect(canTransition('in_progress', 'ready')).toBe(true);
  });
});
