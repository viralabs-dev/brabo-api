import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import {
  ProjectRepository,
  type ProjectInput,
} from '../../ports/project-repository.port';
import { SeedAgentAreasUseCase } from '../agents/seed-agent-areas.use-case';

@Injectable()
export class CreateProjectUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly projects: ProjectRepository,
    private readonly seedAreas: SeedAgentAreasUseCase,
  ) {}

  /**
   * O projeto nasce COM as áreas de agente (RN-094).
   *
   * Na mesma transação, pelo mesmo motivo de `CreateWorkspaceUseCase` gravar o
   * `owner` junto: projeto sem área é projeto onde o teto de paralelismo lê
   * tabela vazia e cai no default sem que ninguém tenha decidido nada. Se o
   * seeding falhar, o projeto não existe — em vez de existir quebrado, que é o
   * estado que a FASE 18 foi corrigir.
   */
  execute(workspaceId: string, userId: string, input: ProjectInput) {
    return this.unitOfWork.runInTransaction(async () => {
      const project = await this.projects.create({
        ...input,
        workspaceId,
        createdBy: userId,
      });
      await this.seedAreas.execute(project.id);
      return project;
    });
  }
}
