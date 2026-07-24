import { Injectable } from '@nestjs/common';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { StoryRepository } from '../../ports/backlog-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { missingModules } from '../../../domain/architecture/module-resolution';
import type { ModuleMap } from '../../../domain/architecture/module-map.entity';

export interface AdrRef {
  actionId: string;
  title: string;
  status: string;
  pullRequestUrl: string | null;
}

export interface ArchitecturePendency {
  storyId: string;
  title: string;
  status: string;
  reason: 'no_module' | 'missing_module';
  missing: string[];
}

export interface Architecture {
  moduleMap: ModuleMap | null;
  adrs: AdrRef[];
  pendencies: ArchitecturePendency[];
}

/**
 * Seção de arquitetura da visão geral: o module_map vigente, as ADRs
 * (proposed_actions open_adr_pr do projeto → título + status + link da PR) e as
 * pendências de validação cruzada (stories sem módulo OU com módulo faltante).
 */
@Injectable()
export class GetArchitectureUseCase {
  constructor(
    private readonly moduleMaps: ModuleMapRepository,
    private readonly stories: StoryRepository,
    private readonly proposedActions: ProposedActionRepository,
  ) {}

  async execute(projectId: string): Promise<Architecture> {
    const [moduleMap, stories, adrActions] = await Promise.all([
      this.moduleMaps.findCurrent(projectId),
      this.stories.findByProject(projectId),
      this.proposedActions.listByProjectAndType(projectId, 'open_adr_pr'),
    ]);

    const names = moduleMap?.modules.map((m) => m.name) ?? [];

    const adrs: AdrRef[] = adrActions.map((a) => {
      const title =
        (a.payload as { title?: string })?.title ?? '(ADR sem título)';
      const url =
        a.executionResult && 'pullRequestUrl' in a.executionResult
          ? a.executionResult.pullRequestUrl || null
          : null;
      return { actionId: a.id, title, status: a.status, pullRequestUrl: url };
    });

    const pendencies: ArchitecturePendency[] = [];
    for (const story of stories) {
      if (story.moduleIds.length === 0) {
        pendencies.push({
          storyId: story.id,
          title: story.title,
          status: story.status,
          reason: 'no_module',
          missing: [],
        });
        continue;
      }
      const missing = missingModules(story.moduleIds, names);
      if (missing.length > 0) {
        pendencies.push({
          storyId: story.id,
          title: story.title,
          status: story.status,
          reason: 'missing_module',
          missing,
        });
      }
    }

    return { moduleMap, adrs, pendencies };
  }
}
