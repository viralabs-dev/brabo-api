// Rastreabilidade regra→stories (Fase 3b, CLAUDE.md 3b.7): para cada regra de
// negócio, quais histórias a cobrem. Uma regra sem cobertura é uma
// "descoberta" — pendência do PO. Puro, sem IO.

export interface RuleView {
  id: string;
  title: string;
}

export interface StoryCoverageView {
  id: string;
  title: string;
  businessRuleIds: string[];
}

export interface RuleCoverage {
  ruleId: string;
  title: string;
  coveredByStoryIds: string[];
  covered: boolean;
}

export interface CoverageReport {
  rules: RuleCoverage[];
  uncoveredCount: number;
}

export function computeCoverage(
  rules: RuleView[],
  stories: StoryCoverageView[],
): CoverageReport {
  const ruleCoverages = rules.map((rule): RuleCoverage => {
    const coveredByStoryIds = stories
      .filter((s) => s.businessRuleIds.includes(rule.id))
      .map((s) => s.id);
    return {
      ruleId: rule.id,
      title: rule.title,
      coveredByStoryIds,
      covered: coveredByStoryIds.length > 0,
    };
  });

  return {
    rules: ruleCoverages,
    uncoveredCount: ruleCoverages.filter((r) => !r.covered).length,
  };
}
