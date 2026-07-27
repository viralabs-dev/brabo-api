import { BadRequestException, Injectable } from '@nestjs/common';
import {
  EpicRepository,
  StoryRepository,
} from '../../ports/backlog-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { canBecomeReady } from '../../../domain/backlog/story-readiness';
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
 * Cria em `draft` e, se satisfaz a regra de prontidão do domínio
 * (DoD/DoR/RF/regra), promove pra `ready` na mesma operação. Nada é criado se
 * a validação falha.
 */
@Injectable()
export class CreateStoryUseCase {
  constructor(
    private readonly stories: StoryRepository,
    private readonly epics: EpicRepository,
    private readonly sessionEvents: SessionEventRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
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

    // Promoção draft→ready pela regra de domínio (mesma de story-readiness).
    if (canBecomeReady(story)) {
      story = await this.stories.updateStatus(story.id, 'ready');
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

    return story;
  }
}
