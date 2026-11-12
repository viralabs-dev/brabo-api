import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ProjectRepository,
  type ProjectInput,
} from '../../ports/project-repository.port';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { idiomaDoProjetoOuRecusa } from './idioma-do-projeto';

@Injectable()
export class UpdateProjectUseCase {
  private readonly logger = new Logger(UpdateProjectUseCase.name);

  constructor(
    private readonly projects: ProjectRepository,
    private readonly engine: ApiToEngineClient,
  ) {}

  async execute(id: string, input: Partial<ProjectInput>) {
    // O idioma do projeto (RN-619) passa pela régua e é gravado CANÔNICO;
    // inválido recusa o corpo inteiro antes de qualquer escrita.
    const alteracao =
      input.language === undefined
        ? input
        : { ...input, language: idiomaDoProjetoOuRecusa(input.language) };
    const row = await this.projects.update(id, alteracao);
    if (!row) throw new NotFoundException('Projeto não encontrado');

    // RN-1142 (AT-917): o teto novo chega aos dev agents vivos. A falha do
    // engine NÃO desfaz a mudança do projeto: o valor já está no banco e o
    // agente o relê na próxima ativação/reidratação.
    if (typeof input.taskBudgetMicros === 'number') {
      try {
        await this.engine.setTaskBudget(id, input.taskBudgetMicros);
      } catch (err) {
        this.logger.warn(
          `teto_nao_propagado projectId=${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return row;
  }
}
