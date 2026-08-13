import { Injectable } from '@nestjs/common';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { StoryRepository } from '../../ports/backlog-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { missingModules } from '../../../domain/architecture/module-resolution';
import type { ModuleMap } from '../../../domain/architecture/module-map.entity';
import { GetC4DiagramUseCase } from './get-c4-diagram.use-case';
import type { EstadoDoC4Diagrama } from '../../../domain/architecture/c4-diagram';

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
  /** Diagrama C4 (Context + Container) vigente, ou `sem_diagrama` (FASE do diagrama C4). */
  c4Diagram: EstadoDoC4Diagrama;
}

/**
 * Seção de arquitetura da visão geral: o module_map vigente, as ADRs
 * (proposed_actions open_adr_pr do projeto → título + status + link da PR), as
 * pendências de validação cruzada (stories sem módulo OU com módulo faltante)
 * e o diagrama C4 vigente (`GetC4DiagramUseCase`, mesmo padrão do container
 * do projeto — ADR 0065).
 */
@Injectable()
export class GetArchitectureUseCase {
  constructor(
    private readonly moduleMaps: ModuleMapRepository,
    private readonly stories: StoryRepository,
    private readonly proposedActions: ProposedActionRepository,
    private readonly getC4Diagram: GetC4DiagramUseCase,
  ) {}

  async execute(projectId: string): Promise<Architecture> {
    const [moduleMap, stories, adrActions, c4Diagram] = await Promise.all([
      this.moduleMaps.findCurrent(projectId),
      this.stories.findByProject(projectId),
      this.proposedActions.listByProjectAndType(projectId, 'open_adr_pr'),
      this.getC4Diagram.execute(projectId),
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

    return { moduleMap, adrs, pendencies, c4Diagram };
  }
}
