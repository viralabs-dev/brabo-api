import { describe, it, expect } from 'vitest';
import {
  computeCoverage,
  type RuleView,
  type StoryCoverageView,
} from '../../../src/domain/backlog/coverage';

const rules: RuleView[] = [
  { id: 'r1', title: 'Maiores de 18' },
  { id: 'r2', title: 'Pagamento em BRL' },
  { id: 'r3', title: 'LGPD' },
];

const stories: StoryCoverageView[] = [
  { id: 's1', title: 'Cadastro', businessRuleIds: ['r1', 'r3'] },
  { id: 's2', title: 'Checkout', businessRuleIds: ['r2'] },
  { id: 's3', title: 'Perfil', businessRuleIds: ['r1'] },
];

describe('coverage', () => {
  it('mapeia cada regra às stories que a cobrem', () => {
    const report = computeCoverage(rules, stories);
    const r1 = report.rules.find((r) => r.ruleId === 'r1')!;
    expect(r1.coveredByStoryIds.sort()).toEqual(['s1', 's3']);
    expect(r1.covered).toBe(true);

    const r2 = report.rules.find((r) => r.ruleId === 'r2')!;
    expect(r2.coveredByStoryIds).toEqual(['s2']);
  });

  it('marca regra sem cobertura como descoberta', () => {
    // r3 é coberta por s1; removendo s1, r3 fica descoberta.
    const report = computeCoverage(rules, [stories[1], stories[2]]);
    const r3 = report.rules.find((r) => r.ruleId === 'r3')!;
    expect(r3.covered).toBe(false);
    expect(r3.coveredByStoryIds).toEqual([]);
    expect(report.uncoveredCount).toBe(1);
  });

  it('sem regras → relatório vazio, 0 descobertas', () => {
    const report = computeCoverage([], stories);
    expect(report.rules).toEqual([]);
    expect(report.uncoveredCount).toBe(0);
  });

  it('todas cobertas → uncoveredCount 0', () => {
    expect(computeCoverage(rules, stories).uncoveredCount).toBe(0);
  });
});
