import { describe, it, expect } from 'vitest';
import {
  nextGateStatus,
  InvalidGateActionError,
} from '../../../src/domain/execution/pr-gate-state-machine';

describe('pr-gate-state-machine', () => {
  it('QA aprovado avança pra awaiting_secops e zera o contador', () => {
    const result = nextGateStatus('awaiting_qa', 'qa', 'approved', 2, 3);
    expect(result).toEqual({ status: 'awaiting_secops', correctionCount: 0 });
  });

  it('SecOps aprovado avança pra awaiting_user e zera o contador', () => {
    const result = nextGateStatus(
      'awaiting_secops',
      'secops',
      'approved',
      1,
      3,
    );
    expect(result).toEqual({ status: 'awaiting_user', correctionCount: 0 });
  });

  it('ordem imutável: aprovar QA nunca pula direto pra awaiting_user', () => {
    const result = nextGateStatus('awaiting_qa', 'qa', 'approved', 0, 3);
    expect(result.status).toBe('awaiting_secops');
    expect(result.status).not.toBe('awaiting_user');
  });

  it('changes_requested sob o teto mantém o MESMO gate, incrementa o contador', () => {
    const result = nextGateStatus(
      'awaiting_qa',
      'qa',
      'changes_requested',
      0,
      3,
    );
    expect(result).toEqual({ status: 'awaiting_qa', correctionCount: 1 });
  });

  it('changes_requested estourando o teto vira blocked', () => {
    const result = nextGateStatus(
      'awaiting_secops',
      'secops',
      'changes_requested',
      3,
      3,
    );
    expect(result).toEqual({ status: 'blocked', correctionCount: 4 });
  });

  it('changes_requested exatamente no teto ainda não bloqueia (só a próxima estoura)', () => {
    const result = nextGateStatus(
      'awaiting_qa',
      'qa',
      'changes_requested',
      2,
      3,
    );
    expect(result).toEqual({ status: 'awaiting_qa', correctionCount: 3 });
  });

  it('SecOps não pode agir sobre awaiting_qa (gate errado)', () => {
    expect(() =>
      nextGateStatus('awaiting_qa', 'secops', 'approved', 0, 3),
    ).toThrow(InvalidGateActionError);
  });

  it('QA não pode agir sobre awaiting_secops (gate errado)', () => {
    expect(() =>
      nextGateStatus('awaiting_secops', 'qa', 'approved', 0, 3),
    ).toThrow(InvalidGateActionError);
  });

  it('nenhum gate pode agir sobre awaiting_user (terminal)', () => {
    expect(() =>
      nextGateStatus('awaiting_user', 'qa', 'approved', 0, 3),
    ).toThrow(InvalidGateActionError);
    expect(() =>
      nextGateStatus('awaiting_user', 'secops', 'approved', 0, 3),
    ).toThrow(InvalidGateActionError);
  });
});
