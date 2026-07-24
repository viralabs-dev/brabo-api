import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StoryRepository } from '../../ports/backlog-repository.port';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { missingModules } from '../../../domain/architecture/module-resolution';

export interface AssignStoryModulesInput {
  storyId: string;
  moduleIds: string[];
}

/**
 * O Arquiteto vincula módulos (do module_map vigente) a uma história (tool
 * assign_story_modules). Valida que todos os módulos existem — senão recusa
 * (nada é gravado). É assim que uma story passa a "referenciar módulos
 * válidos". Não muda status.
 */
@Injectable()
export class AssignStoryModulesUseCase {
  constructor(
    private readonly stories: StoryRepository,
    private readonly moduleMaps: ModuleMapRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    input: AssignStoryModulesInput,
  ) {
    const story = await this.stories.findById(input.storyId);
    if (!story || story.projectId !== projectId) {
      throw new NotFoundException('História não encontrada');
    }

    const current = await this.moduleMaps.findCurrent(projectId);
    const names = current?.modules.map((m) => m.name) ?? [];
    const missing = missingModules(input.moduleIds, names);
    if (missing.length > 0) {
      throw new BadRequestException(
        `Módulos inexistentes no module_map vigente: ${missing.join(', ')}`,
      );
    }

    const updated = await this.stories.updateModules(
      input.storyId,
      input.moduleIds,
    );

    await this.appendEvent.execute(projectId, sessionId, {
      type: 'backlog.story_modules_assigned',
      actor: { kind: 'agent', id: 'arquiteto' },
      payload: { storyId: story.id, moduleIds: input.moduleIds },
    });

    return updated;
  }
}
