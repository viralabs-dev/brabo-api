import { describe, it, expect } from 'vitest';
import {
  canBecomeReady,
  assertReady,
  missingForReady,
  StoryNotReadyError,
  type StoryReadinessView,
} from '../../../src/domain/backlog/story-readiness';

const complete: StoryReadinessView = {
  dod: ['testes passando'],
  dor: ['critério de aceite claro'],
  rf: ['permitir cadastro'],
  businessRuleIds: ['evt-rule-1'],
};

describe('story-readiness', () => {
  it('story completa pode ir para ready', () => {
    expect(canBecomeReady(complete)).toBe(true);
    expect(() => assertReady(complete)).not.toThrow();
    expect(missingForReady(complete)).toEqual([]);
  });

  it('rejeita draft→ready sem DoD', () => {
    const story = { ...complete, dod: [] };
    expect(canBecomeReady(story)).toBe(false);
    expect(() => assertReady(story)).toThrow(StoryNotReadyError);
    expect(missingForReady(story)).toContain('dod');
  });

  it('rejeita sem DoR', () => {
    expect(missingForReady({ ...complete, dor: [] })).toContain('dor');
  });

  it('rejeita sem nenhum RF', () => {
    expect(missingForReady({ ...complete, rf: [] })).toContain('rf');
  });

  it('rejeita sem regra de negócio vinculada', () => {
    expect(missingForReady({ ...complete, businessRuleIds: [] })).toContain(
      'business_rule',
    );
  });

  it('o erro lista TODOS os requisitos faltantes', () => {
    try {
      assertReady({ dod: [], dor: [], rf: [], businessRuleIds: [] });
      expect.unreachable('deveria ter lançado');
    } catch (e) {
      expect(e).toBeInstanceOf(StoryNotReadyError);
      expect((e as StoryNotReadyError).missing).toEqual([
        'dod',
        'dor',
        'rf',
        'business_rule',
      ]);
    }
  });
});
