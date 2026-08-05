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
      // A recusa diz os nomes VÁLIDOS, não só os errados.
      //
      // O Arquiteto não tem ferramenta para ler o module_map vigente. Enquanto
      // esta mensagem listava apenas o que não existia, a única saída dele era
      // adivinhar: numa execução real foram 18 chutes em sequência (`api`,
      // `core`, `http`, `greeting`, `domain`, `web`, `hello-api`, `app`,
      // `server`, `publico`, …) até acertar UM por sorte — e as quatro
      // histórias terminaram no mesmo módulo, com o desfecho afirmando que
      // tinham sido vinculadas corretamente.
      //
      // Dizer os nomes encerra a busca na primeira recusa. Quando não há mapa
      // nenhum, o problema é outro e a mensagem tem que dizer ISSO, senão o
      // modelo lê "nenhum válido" como "chute de novo".
      throw new BadRequestException(
        names.length === 0
          ? 'Nenhum module_map foi definido ainda neste projeto: ' +
              'chame create_module_map antes de vincular histórias.'
          : `Módulos inexistentes no module_map vigente: ${missing.join(', ')}. ` +
              `Os módulos válidos são: ${names.join(', ')}.`,
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
