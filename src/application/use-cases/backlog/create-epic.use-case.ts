import { BadRequestException, Injectable } from '@nestjs/common';
import { EpicRepository } from '../../ports/backlog-repository.port';
import { tituloDuplicado } from '../../../domain/backlog/story-overlap';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';

export interface CreateEpicInput {
  title: string;
  description?: string;
}

/**
 * Cria um épico — chamado pela ferramenta create_epic do PO (via endpoint
 * interno). Registra `backlog.epic_created` no event log (narrativa do PO).
 * Título igual a outro épico do projeto é recusado com o id do existente
 * (RN-894, a mesma régua da história no achado R).
 */
@Injectable()
export class CreateEpicUseCase {
  constructor(
    private readonly epics: EpicRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
  ) {}

  async execute(projectId: string, sessionId: string, input: CreateEpicInput) {
    const existente = tituloDuplicado(
      input.title,
      await this.epics.findByProject(projectId),
    );
    if (existente) {
      throw new BadRequestException(
        `Já existe o épico «${existente.title}» (id ${existente.id}) neste projeto — ` +
          `use este id em epic_id`,
      );
    }

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
