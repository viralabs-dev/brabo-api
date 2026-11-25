import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  StoryRepository,
  TaskRepository,
} from '../../ports/backlog-repository.port';
import {
  lerLevantamento,
  type Levantamento,
} from '../../../domain/execution/plano-de-execucao';
import type { Task } from '../../../domain/backlog/backlog.entity';

/**
 * AT-990 (RN-1370): o Dev Lead grava o levantamento da tarefa (arquivos, o que
 * expõe e consome, dependências npm, aceite). Regrava à vontade: o plano lê o
 * último. É por ele que `consome` ganha `expoe` e `depende_de` se justifica.
 */
@Injectable()
export class SetLevantamentoUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly stories: StoryRepository,
  ) {}

  async execute(
    projectId: string,
    taskId: string,
    bruto: unknown,
  ): Promise<Task> {
    const levantamento: Levantamento | null = lerLevantamento(bruto);
    if (!levantamento) {
      throw new BadRequestException(
        'Levantamento inválido: `arquivos`, `expoe`, `consome` e `dependenciasNpm` são listas de texto e `aceite` é obrigatório.',
      );
    }
    const tarefa = await this.tasks.findById(taskId);
    const story = tarefa ? await this.stories.findById(tarefa.storyId) : null;
    if (!tarefa || !story || story.projectId !== projectId) {
      throw new NotFoundException(
        `Tarefa "${taskId}" não encontrada neste projeto`,
      );
    }
    const gravada = await this.tasks.setLevantamento(taskId, levantamento);
    if (!gravada) {
      throw new NotFoundException(`A tarefa "${taskId}" está arquivada.`);
    }
    return gravada;
  }
}
