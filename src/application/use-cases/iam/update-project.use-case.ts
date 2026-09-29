import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ProjectRepository,
  type ProjectInput,
} from '../../ports/project-repository.port';
import { idiomaDoProjetoOuRecusa } from './idioma-do-projeto';

@Injectable()
export class UpdateProjectUseCase {
  constructor(private readonly projects: ProjectRepository) {}

  async execute(id: string, input: Partial<ProjectInput>) {
    // O idioma do projeto (RN-619) passa pela régua e é gravado CANÔNICO;
    // inválido recusa o corpo inteiro antes de qualquer escrita.
    const alteracao =
      input.language === undefined
        ? input
        : { ...input, language: idiomaDoProjetoOuRecusa(input.language) };
    const row = await this.projects.update(id, alteracao);
    if (!row) throw new NotFoundException('Projeto não encontrado');
    return row;
  }
}
