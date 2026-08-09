import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import {
  ProjectRepository,
  type ProjectInput,
} from '../../ports/project-repository.port';
import { SeedAgentAreasUseCase } from '../agents/seed-agent-areas.use-case';
import { workspaceDirNameFor } from '../../../infrastructure/filesystem/project-workspaces-root';

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
   *
   * O id nasce AQUI, em código (`randomUUID`), e não do `defaultRandom()` do
   * Postgres — o nome da pasta do workspace (RN-109) se compõe do id ANTES de
   * o projeto existir na tabela, então o use case precisa do id em mãos antes
   * do insert.
   */
  execute(workspaceId: string, userId: string, input: ProjectInput) {
    return this.unitOfWork.runInTransaction(async () => {
      const id = randomUUID();
      const project = await this.projects.create({
        ...input,
        id,
        workspaceId,
        createdBy: userId,
        workspaceDirName: workspaceDirNameFor(id, input.slug),
      });
      await this.seedAreas.execute(project.id);
      return project;
    });
  }
}
