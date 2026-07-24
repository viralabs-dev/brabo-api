import { BadRequestException, Injectable } from '@nestjs/common';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { StoryRepository } from '../../ports/backlog-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import {
  assertNoCycle,
  ModuleCycleError,
  type ModuleNode,
} from '../../../domain/architecture/module-graph';
import { missingModules } from '../../../domain/architecture/module-resolution';

export interface CreateModuleMapInput {
  modules: ModuleNode[];
}

/**
 * Cria/atualiza o module_map do projeto (tool create_module_map do Arquiteto).
 * Rejeita mapas com CICLO de dependência (validação de domínio). Ao criar o
 * novo mapa, REVALIDA todas as stories `ready`: as que passam a referenciar um
 * módulo que sumiu são rebaixadas a `draft` (com evento — que é a notificação
 * no feed). Emite `artifact.module_map`.
 */
@Injectable()
export class CreateModuleMapUseCase {
  constructor(
    private readonly moduleMaps: ModuleMapRepository,
    private readonly stories: StoryRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    input: CreateModuleMapInput,
  ) {
    try {
      assertNoCycle(input.modules);
    } catch (e) {
      if (e instanceof ModuleCycleError) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }

    const current = await this.moduleMaps.findCurrent(projectId);
    const map = await this.moduleMaps.create({
      projectId,
      sessionId,
      modules: input.modules,
      version: (current?.version ?? 0) + 1,
    });

    await this.appendEvent.execute(projectId, sessionId, {
      type: 'artifact.module_map',
      actor: { kind: 'agent', id: 'arquiteto' },
      payload: {
        moduleMapId: map.id,
        version: map.version,
        modules: map.modules,
      },
    });

    // Revalidação: rebaixa stories `ready` que ficaram órfãs.
    const names = map.modules.map((m) => m.name);
    const readyStories = (await this.stories.findByProject(projectId)).filter(
      (s) => s.status === 'ready',
    );
    for (const story of readyStories) {
      const missing = missingModules(story.moduleIds, names);
      if (missing.length > 0) {
        await this.stories.updateStatus(story.id, 'draft');
        await this.appendEvent.execute(projectId, sessionId, {
          type: 'backlog.story_demoted',
          actor: { kind: 'system', id: 'module-map-revalidation' },
          payload: {
            storyId: story.id,
            title: story.title,
            missingModules: missing,
          },
        });
      }
    }

    return map;
  }
}
