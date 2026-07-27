import { Injectable } from '@nestjs/common';
import { EpicRepository } from '../../ports/backlog-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';

export interface CreateEpicInput {
  title: string;
  description?: string;
}

/**
 * Cria um épico — chamado pela ferramenta create_epic do PO (via endpoint
 * interno). Registra `backlog.epic_created` no event log (narrativa do PO).
 */
@Injectable()
export class CreateEpicUseCase {
  constructor(
    private readonly epics: EpicRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
  ) {}

  async execute(projectId: string, sessionId: string, input: CreateEpicInput) {
    const epic = await this.epics.create({
      projectId,
      sessionId,
      title: input.title,
      description: input.description,
    });

    await this.appendEvent.execute(projectId, sessionId, {
      type: 'backlog.epic_created',
      actor: { kind: 'agent', id: 'po' },
      payload: { epicId: epic.id, title: epic.title },
    });

    return epic;
  }
}
