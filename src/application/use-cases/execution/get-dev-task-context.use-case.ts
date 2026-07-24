import { Injectable, NotFoundException } from '@nestjs/common';
import {
  StoryRepository,
  TaskRepository,
} from '../../ports/backlog-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import type { Story, Task } from '../../../domain/backlog/backlog.entity';

export interface DevContextBusinessRule {
  title: string;
  description: string;
}

export interface DevContextAdr {
  title: string;
  content: string;
  // Fase 4a — SecOps: ADR marcado como relevante de segurança pelo
  // Arquiteto (payload opcional de `open_adr_pr`, default `false`) — vira
  // checklist informativo no parecer do SecOpsAgent, sem correlação
  // profunda linha-a-linha.
  securityRelevant: boolean;
}

export interface DevTaskContext {
  task: Task;
  story: Story;
  businessRules: DevContextBusinessRule[];
  adrs: DevContextAdr[];
}

/**
 * Monta o contexto rico que o DevAgent usa pra implementar a task (camadas
 * `regras_negocio`/`estado_tarefa` do harness): a story completa (RF/RNF/DoD/
 * DoR), as regras de negócio referenciadas (resolvidas via session_events
 * `artifact.business_rule`, mesmo padrão de `CreateStoryUseCase`), e os ADRs
 * do projeto (todos — não há vínculo ADR↔módulo hoje, mesma simplificação já
 * assumida por `GetArchitectureUseCase`).
 */
@Injectable()
export class GetDevTaskContextUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly stories: StoryRepository,
    private readonly sessionEvents: SessionEventRepository,
    private readonly proposedActions: ProposedActionRepository,
  ) {}

  async execute(projectId: string, taskId: string): Promise<DevTaskContext> {
    const task = await this.tasks.findById(taskId);
    if (!task) {
      throw new NotFoundException(`Task "${taskId}" não encontrada`);
    }

    const story = await this.stories.findById(task.storyId);
    if (!story || story.projectId !== projectId) {
      throw new NotFoundException(
        `Story da task "${taskId}" não encontrada neste projeto`,
      );
    }

    const [businessRules, adrActions] = await Promise.all([
      this.resolveBusinessRules(story.businessRuleIds),
      this.proposedActions.listByProjectAndType(projectId, 'open_adr_pr'),
    ]);

    const adrs: DevContextAdr[] = adrActions.map((a) => {
      const payload = a.payload as {
        title?: string;
        content?: string;
        securityRelevant?: boolean;
      };
      return {
        title: payload.title ?? '(ADR sem título)',
        content: payload.content ?? '',
        securityRelevant: payload.securityRelevant ?? false,
      };
    });

    return { task, story, businessRules, adrs };
  }

  private async resolveBusinessRules(
    ids: string[],
  ): Promise<DevContextBusinessRule[]> {
    const rules = await Promise.all(
      ids.map(async (id) => {
        const event = await this.sessionEvents.findById(id);
        if (!event || event.type !== 'artifact.business_rule') return null;
        const payload = event.payload as {
          title?: string;
          description?: string;
        };
        return {
          title: payload.title ?? '(regra sem título)',
          description: payload.description ?? '',
        };
      }),
    );
    return rules.filter((r): r is DevContextBusinessRule => r !== null);
  }
}
