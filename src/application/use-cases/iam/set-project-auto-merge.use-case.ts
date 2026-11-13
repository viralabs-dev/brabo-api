import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import { MergeAutomaticoEventoRepository } from '../../ports/merge-automatico-evento-repository.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ResolveEffectiveRoleUseCase } from './resolve-effective-role.use-case';
import { roleAtLeast } from '../../../domain/iam/role';
import type { Project } from '../../../domain/iam/project.entity';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

/**
 * Liga/desliga o merge automático do projeto (RN-1316, AT-902, ADR 0292).
 *
 * Rota PRÓPRIA, e não o `PATCH`, porque a chave tira um teto de segurança: o
 * `UpdateProjectDto` herda campo novo sem passar por aqui. A rota exige
 * `maintainer`; LIGAR exige `owner` (decisão do dono, 12/11/2026) — desligar só
 * devolve o teto, por isso o `maintainer` basta. Cada mudança grava um evento
 * imutável (quem, quando); repetir o valor atual não grava nada.
 */
@Injectable()
export class SetProjectAutoMergeUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly projects: ProjectRepository,
    private readonly eventos: MergeAutomaticoEventoRepository,
    private readonly resolveEffectiveRole: ResolveEffectiveRoleUseCase,
  ) {}

  @Traced('application')
  async execute(
    projectId: string,
    atorId: string,
    habilitado: boolean,
  ): Promise<Project> {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');

    if (habilitado) {
      const papel = await this.resolveEffectiveRole.forProject(
        atorId,
        projectId,
      );
      if (!papel || !roleAtLeast(papel, 'owner')) {
        throw new ForbiddenException(
          'Ligar o merge automático exige o papel owner do workspace: ele tira a revisão humana do merge. Desligar basta ser maintainer.',
        );
      }
    }

    if (project.mergeAutomatico === habilitado) return project;

    return this.unitOfWork.runInTransaction(async () => {
      const atualizado = await this.projects.update(projectId, {
        mergeAutomatico: habilitado,
      });
      if (!atualizado) throw new NotFoundException('Projeto não encontrado');
      await this.eventos.registrar({ projectId, userId: atorId, habilitado });
      return atualizado;
    });
  }
}
