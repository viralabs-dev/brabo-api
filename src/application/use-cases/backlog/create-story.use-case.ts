import { BadRequestException, Injectable } from '@nestjs/common';
import {
  EpicRepository,
  StoryRepository,
} from '../../ports/backlog-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { isPromotable } from '../../../domain/backlog/story-promotion';
import type { Story } from '../../../domain/backlog/backlog.entity';

export interface CreateStoryInput {
  epicId: string;
  title: string;
  description?: string;
  rf?: string[];
  rnf?: string[];
  dod?: string[];
  dor?: string[];
  businessRuleIds?: string[];
}

/**
 * Cria uma história (via ferramenta create_story do PO). Valida que:
 *  - o épico existe no projeto;
 *  - cada business_rule_id referencia MESMO um evento artifact.business_rule
 *    existente (justificativa rastreável — recusa ids inventados).
 * Nada é criado se a validação falha.
 *
 * O que acontece DEPOIS de criar depende do modo do projeto (Fase 12c —
 * RN-048):
 *  - `auto`: se a story satisfaz `assertPromotable`, vai direto a `ready`.
 *    É o comportamento anterior à 12c, agora opt-in.
 *  - `manual` (default de projeto novo): a story fica `draft` com
 *    `proposedReady`, e QUEM promove é o usuário, na aba Backlog.
 *
 * O modo muda só QUEM dispara — o que é validado é o mesmo
 * `isPromotable`/`assertPromotable` nos dois casos (requisito 3 da fase).
 */
@Injectable()
export class CreateStoryUseCase {
  constructor(
    private readonly stories: StoryRepository,
    private readonly epics: EpicRepository,
    private readonly sessionEvents: SessionEventRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly projects: ProjectRepository,
    private readonly moduleMaps: ModuleMapRepository,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    input: CreateStoryInput,
  ): Promise<Story> {
    const epic = await this.epics.findById(input.epicId);
    if (!epic || epic.projectId !== projectId) {
      throw new BadRequestException(
        `Épico "${input.epicId}" não encontrado neste projeto`,
      );
    }

    const businessRuleIds = input.businessRuleIds ?? [];
    for (const ruleId of businessRuleIds) {
      const event = await this.sessionEvents.findById(ruleId);
      if (!event || event.type !== 'artifact.business_rule') {
        throw new BadRequestException(
          `business_rule_id "${ruleId}" não corresponde a uma regra de negócio existente`,
        );
      }
    }

    const project = await this.projects.findById(projectId);
    const modo = project?.storyPromotion ?? 'manual';

    // O module_map vigente é lido nos DOIS modos, e não só quando promove:
    // é o que faz a simetria da validação ser real em vez de coincidência.
    // Hoje `moduleIds` é sempre `[]` na criação (quem atribui módulo é o
    // Arquiteto, depois), então na prática isto sempre passa — mas se a
    // criação um dia aceitar módulos, ela já valida como a promoção.
    const moduleMap = await this.moduleMaps.findCurrent(projectId);
    const moduleNames = moduleMap?.modules.map((m) => m.name) ?? [];

    let story = await this.stories.create({
      epicId: input.epicId,
      projectId,
      sessionId,
      title: input.title,
      description: input.description,
      rf: input.rf ?? [],
      rnf: input.rnf ?? [],
      dod: input.dod ?? [],
      dor: input.dor ?? [],
      businessRuleIds,
    });

    const promovivel = isPromotable(story, moduleNames);

    if (modo === 'auto' && promovivel) {
      story = await this.stories.updateStatus(story.id, 'ready');
    } else if (modo === 'manual' && promovivel) {
      // Fica `draft` — logo, nenhuma task dela é pegável — e entra na fila
      // do usuário. Story incompleta NÃO entra: propor algo que a própria
      // validação recusaria seria empurrar trabalho do PO para o usuário.
      story = await this.stories.setProposedReady(story.id, true);
    }

    await this.appendEvent.execute(projectId, sessionId, {
      type: 'backlog.story_created',
      actor: { kind: 'agent', id: 'po' },
      payload: {
        storyId: story.id,
        epicId: story.epicId,
        title: story.title,
        status: story.status,
        businessRuleIds: story.businessRuleIds,
      },
    });

    if (story.proposedReady) {
      await this.appendEvent.execute(projectId, sessionId, {
        type: 'backlog.story_promotion_proposed',
        actor: { kind: 'agent', id: 'po' },
        payload: {
          storyId: story.id,
          epicId: story.epicId,
          title: story.title,
        },
      });
    }

    return story;
  }
}
