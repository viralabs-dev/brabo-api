import { Injectable } from '@nestjs/common';
import { StoryRepository } from '../../ports/backlog-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import {
  computeCoverage,
  type CoverageReport,
  type RuleView,
} from '../../../domain/backlog/coverage';

/**
 * Rastreabilidade regra→stories do projeto: para cada regra de negócio
 * (artifact.business_rule das sessões do projeto), quais histórias a cobrem.
 * Regras sem cobertura são as "descobertas" (pendência do PO).
 */
@Injectable()
export class GetCoverageUseCase {
  constructor(
    private readonly sessionEvents: SessionEventRepository,
    private readonly stories: StoryRepository,
  ) {}

  async execute(projectId: string): Promise<CoverageReport> {
    const [ruleEvents, stories] = await Promise.all([
      this.sessionEvents.listByTypeForProject(
        projectId,
        'artifact.business_rule',
      ),
      this.stories.findByProject(projectId),
    ]);

    const rules: RuleView[] = ruleEvents.map((e) => ({
      id: e.id,
      title: (e.payload as { title?: string })?.title ?? '(regra sem título)',
    }));

    return computeCoverage(
      rules,
      stories.map((s) => ({
        id: s.id,
        title: s.title,
        businessRuleIds: s.businessRuleIds,
      })),
    );
  }
}
