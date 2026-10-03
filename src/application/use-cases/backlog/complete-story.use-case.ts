import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StoryRepository } from '../../ports/backlog-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { isPromotable } from '../../../domain/backlog/story-promotion';
import type { Story } from '../../../domain/backlog/backlog.entity';

export interface CompleteStoryInput {
  storyId: string;
  description?: string;
  rf?: string[];
  rnf?: string[];
  dod?: string[];
  dor?: string[];
  businessRuleIds?: string[];
}

/**
 * COMPLETA uma história `draft` existente (ferramenta `complete_story` do PO,
 * RN-720). Existe porque o PO só tinha `create_story`: uma história criada
 * sem regras ligadas ficava `draft` para sempre, e a única saída era recriá-la
 * — o que dispara a duplicata semântica (RN-681) e deixa a original órfã.
 *
 * Regras:
 *  - a história é do PROJETO e está `draft` (história `ready` não se reescreve
 *    por aqui);
 *  - `businessRuleIds` é SOMADO aos já ligados (completar nunca desliga uma
 *    regra), e cada id novo precisa ser um `artifact.business_rule` existente;
 *  - listas informadas e não vazias SUBSTITUEM as atuais; omitidas ficam;
 *  - depois de gravar, a promoção segue o MESMO critério de `create_story`
 *    (`isPromotable`, e o modo do projeto decide se vai a `ready` ou fica
 *    `proposedReady`).
 */
@Injectable()
export class CompleteStoryUseCase {
  constructor(
    private readonly stories: StoryRepository,
    private readonly sessionEvents: SessionEventRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly projects: ProjectRepository,
    private readonly moduleMaps: ModuleMapRepository,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    input: CompleteStoryInput,
  ): Promise<Story> {
    const atual = await this.stories.findById(input.storyId);
    if (!atual || atual.projectId !== projectId) {
      throw new NotFoundException(
        `História "${input.storyId}" não encontrada neste projeto`,
      );
    }
    if (atual.status !== 'draft') {
      throw new ConflictException(
        `A história "${atual.title}" está ${atual.status} — só história draft é completada`,
      );
    }

    const novas = (input.businessRuleIds ?? []).filter(
      (id) => !atual.businessRuleIds.includes(id),
    );
    for (const ruleId of novas) {
      const event = await this.sessionEvents.findById(ruleId);
      if (!event || event.type !== 'artifact.business_rule') {
        throw new BadRequestException(
          `business_rule_id "${ruleId}" não corresponde a uma regra de negócio existente`,
        );
      }
    }

    const ou = (nova: string[] | undefined, velha: string[]) =>
      nova && nova.length > 0 ? nova : velha;

    let story = await this.stories.updateContent(atual.id, {
      description: input.description ?? atual.description,
      rf: ou(input.rf, atual.rf),
      rnf: ou(input.rnf, atual.rnf),
      dod: ou(input.dod, atual.dod),
      dor: ou(input.dor, atual.dor),
      businessRuleIds: [...atual.businessRuleIds, ...novas],
    });

    const project = await this.projects.findById(projectId);
    const modo = project?.storyPromotion ?? 'manual';
    const moduleMap = await this.moduleMaps.findCurrent(projectId);
    const moduleNames = moduleMap?.modules.map((m) => m.name) ?? [];
    const promovivel = isPromotable(story, moduleNames);

    if (modo === 'auto' && promovivel) {
      story = await this.stories.updateStatus(story.id, 'ready');
    } else if (modo === 'manual' && promovivel && !story.proposedReady) {
      story = await this.stories.setProposedReady(story.id, true);
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

    await this.appendEvent.execute(projectId, sessionId, {
      type: 'backlog.story_completed',
      actor: { kind: 'agent', id: 'po' },
      payload: {
        storyId: story.id,
        title: story.title,
        status: story.status,
        businessRuleIds: story.businessRuleIds,
      },
    });

    return story;
  }
}
