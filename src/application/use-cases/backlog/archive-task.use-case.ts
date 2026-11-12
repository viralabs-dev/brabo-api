import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  StoryRepository,
  TaskRepository,
} from '../../ports/backlog-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import type { Task } from '../../../domain/backlog/backlog.entity';

/** Quem arquiva: o dono (tela, qualquer tarefa `todo`) ou o Dev Lead. */
export type AtorDoArquivamento =
  { kind: 'user'; id: string } | { kind: 'agent'; id: 'dev-lead' };

/**
 * Arquivar tarefa (AT-912, RN-1084, decisão do dono de 11/11): um gesto só,
 * com motivo OBRIGATÓRIO — cancelar e arquivar são a mesma coisa. Só tarefa
 * `todo` (bloqueada ou não); a que tem agente (`in_progress`/`in_review`) é 409
 * nomeado. O dono arquiva qualquer uma pela tela; o Dev Lead, só a que ELE
 * mesmo criou. Nada é apagado: a linha fica com `archivedAt`, o evento
 * `backlog.task_archived` guarda quem e por quê, e o claim, a contagem de
 * paralelização, a execução parada e as dependências a ignoram.
 */
@Injectable()
export class ArchiveTaskUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly stories: StoryRepository,
    private readonly sessionEvents: SessionEventRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(
    projectId: string,
    taskId: string,
    motivo: string,
    ator: AtorDoArquivamento,
  ): Promise<Task> {
    const reason = motivo?.trim();
    if (!reason) {
      throw new BadRequestException('Informe o motivo do arquivamento.');
    }
    const tarefa = await this.tasks.findById(taskId);
    const story = tarefa ? await this.stories.findById(tarefa.storyId) : null;
    if (!tarefa || !story || story.projectId !== projectId) {
      throw new NotFoundException(
        `Tarefa "${taskId}" não encontrada neste projeto`,
      );
    }
    if (tarefa.archivedAt) {
      throw new ConflictException({
        message: `A tarefa "${tarefa.title}" já está arquivada.`,
        reason: 'tarefa_arquivada',
      });
    }
    if (tarefa.status !== 'todo') {
      throw new ConflictException({
        message:
          `A tarefa "${tarefa.title}" está com ${tarefa.assignedTo ?? 'um agente'} ` +
          `(${tarefa.status}): desbloqueie ou espere o gate — só tarefa \`todo\` se arquiva.`,
        reason: 'tarefa_em_execucao',
      });
    }
    if (
      ator.kind === 'agent' &&
      !(await this.criouODevLead(projectId, taskId))
    ) {
      throw new ConflictException({
        message:
          'O Dev Lead só arquiva a tarefa que ele mesmo criou; pergunte ao dono.',
        reason: 'tarefa_de_outro_autor',
      });
    }

    return this.unitOfWork.runInTransaction(async () => {
      const arquivada = await this.tasks.archive(taskId, reason);
      if (!arquivada) {
        // Perdeu a corrida para o claim: a tarefa virou `in_progress`.
        throw new ConflictException({
          message: `A tarefa "${tarefa.title}" acabou de ser pega por um dev agent.`,
          reason: 'tarefa_em_execucao',
        });
      }
      await this.appendEvent.execute(projectId, story.sessionId, {
        type: 'backlog.task_archived',
        actor: ator,
        payload: { taskId, storyId: story.id, title: tarefa.title, reason },
      });
      return arquivada;
    });
  }

  private async criouODevLead(projectId: string, taskId: string) {
    const criadas = await this.sessionEvents.listByTypeForProject(
      projectId,
      'backlog.task_created',
    );
    return criadas.some(
      (e) =>
        (e.payload as { taskId?: string } | null)?.taskId === taskId &&
        (e.actor.id === 'dev_lead' || e.actor.id === 'dev-lead'),
    );
  }
}
