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
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { recusaDeCorrecaoDeHistoria } from '../../../domain/backlog/correcao-de-historia';
import type { Story } from '../../../domain/backlog/backlog.entity';

export type AtorDaCorrecao =
  { kind: 'user'; id: string } | { kind: 'agent'; id: 'po' };

export const TETO_DO_TITULO = 200;

/**
 * Editar o título e ARQUIVAR uma história (RN-727, ADR 0212) — as duas
 * correções que o PO (ferramentas `update_story`/`archive_story`) e o usuário
 * (aba Backlog) podem fazer. UMA régua para as duas portas:
 * `recusaDeCorrecaoDeHistoria`, só `draft` e sem tarefa em execução.
 *
 * Nada é apagado: a linha de `stories` fica (com `archived_at`), as tarefas
 * ficam, e o evento (`backlog.story_updated`/`backlog.story_archived`) guarda
 * o antes, o depois e quem fez. A história arquivada sai do jogo porque toda
 * leitura que decide (backlog, cobertura, fila de promoção, plano, claim)
 * filtra `archived_at IS NULL` — e as tarefas dela saem junto, pela história.
 */
@Injectable()
export class CorrigirHistoriaUseCase {
  constructor(
    private readonly stories: StoryRepository,
    private readonly tasks: TaskRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  /**
   * Corrige o TÍTULO e/ou a DESCRIÇÃO. Campo omitido fica como está; nada
   * mudou = nenhum evento. RF/DoD/DoR e regras continuam sendo da
   * `complete_story` (RN-720), que não muda título.
   */
  async editar(
    projectId: string,
    storyId: string,
    campos: { title?: string; description?: string },
    ator: AtorDaCorrecao,
  ): Promise<Story> {
    const titulo = campos.title?.trim();
    if (
      titulo !== undefined &&
      (titulo === '' || titulo.length > TETO_DO_TITULO)
    ) {
      throw new BadRequestException(
        `O título precisa ter entre 1 e ${TETO_DO_TITULO} caracteres.`,
      );
    }
    if (titulo === undefined && campos.description === undefined) {
      throw new BadRequestException('Informe o título ou a descrição.');
    }
    const { story } = await this.corrigivel(projectId, storyId);
    const novo = {
      title: titulo ?? story.title,
      description: campos.description ?? story.description,
    };
    if (novo.title === story.title && novo.description === story.description) {
      return story;
    }

    return this.unitOfWork.runInTransaction(async () => {
      const atualizada = await this.stories.updateText(storyId, novo);
      await this.appendEvent.execute(projectId, story.sessionId, {
        type: 'backlog.story_updated',
        actor: ator,
        payload: {
          storyId,
          previousTitle: story.title,
          title: novo.title,
          descriptionChanged: novo.description !== story.description,
        },
      });
      return atualizada;
    });
  }

  async arquivar(
    projectId: string,
    storyId: string,
    motivo: string | null,
    ator: AtorDaCorrecao,
  ): Promise<Story> {
    const { story, tarefas } = await this.corrigivel(projectId, storyId);
    const reason = motivo?.trim() ? motivo.trim() : null;

    return this.unitOfWork.runInTransaction(async () => {
      const arquivada = await this.stories.archive(storyId, reason);
      await this.appendEvent.execute(projectId, story.sessionId, {
        type: 'backlog.story_archived',
        actor: ator,
        payload: {
          storyId,
          title: story.title,
          reason,
          // As tarefas saem do jogo junto com a história (pelo filtro da
          // história no plano e no claim); o evento diz quais eram.
          taskIds: tarefas.map((t) => t.id),
        },
      });
      return arquivada;
    });
  }

  private async corrigivel(projectId: string, storyId: string) {
    const story = await this.stories.findById(storyId);
    if (!story || story.projectId !== projectId) {
      throw new NotFoundException(
        `História "${storyId}" não encontrada neste projeto`,
      );
    }
    const tarefas = await this.tasks.findByStoryIds([storyId]);
    const recusa = recusaDeCorrecaoDeHistoria(story, tarefas);
    if (recusa) throw new ConflictException(recusa);
    return { story, tarefas };
  }
}
