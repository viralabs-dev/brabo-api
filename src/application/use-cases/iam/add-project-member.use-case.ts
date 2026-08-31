import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import { WorkspaceRepository } from '../../ports/workspace-repository.port';
import { ResolveEffectiveRoleUseCase } from './resolve-effective-role.use-case';
import {
  MENSAGEM_TETO_AUTO_REBAIXAMENTO,
  MENSAGEM_TETO_OWNER_DO_WORKSPACE,
  ehAutoRebaixamento,
  rebaixaOwnerDoWorkspace,
} from '../../../domain/iam/tetos-de-rebaixamento';
import type { Role } from '../../../domain/iam/role';

/**
 * Associa (ou re-associa, é upsert) alguém ao projeto, aplicando os dois tetos
 * de rebaixamento antes de escrever (ADR 0127, RN-472).
 *
 * Os tetos moram AQUI e não no `RolesGuard` porque o guard responde outra
 * pergunta: ele autoriza o CHAMADOR contra o `@RequireRole` da rota, e não vê
 * corpo (`dto.role`) nem alvo (`dto.userId`) — os dois tetos são sobre o ALVO e
 * sobre a relação ator↔alvo. Um guard que precisasse do corpo teria de conhecer
 * o DTO de cada rota, que é exatamente a fronteira que ele existe para não
 * cruzar.
 *
 * `ResolveEffectiveRoleUseCase` entra como dependência para o papel do ATOR não
 * virar uma SEGUNDA composição de `projectRole ?? workspaceRole` escrita à mão
 * aqui (precedente: `ProposeActionUseCase`). O papel do ALVO no workspace vem
 * direto do repositório porque é o papel de WORKSPACE, cru — não o efetivo.
 */
@Injectable()
export class AddProjectMemberUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly workspaces: WorkspaceRepository,
    private readonly resolveEffectiveRole: ResolveEffectiveRoleUseCase,
  ) {}

  async execute(
    projectId: string,
    atorId: string,
    alvoId: string,
    papel: Role,
  ) {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');

    const papelDoAlvoNoWorkspace = await this.workspaces.findMemberRole(
      project.workspaceId,
      alvoId,
    );
    if (rebaixaOwnerDoWorkspace(papelDoAlvoNoWorkspace, papel)) {
      throw new ForbiddenException(MENSAGEM_TETO_OWNER_DO_WORKSPACE);
    }

    const papelEfetivoDoAtorNoProjeto =
      await this.resolveEffectiveRole.forProject(atorId, projectId);
    if (
      ehAutoRebaixamento({
        atorId,
        alvoId,
        papelEfetivoDoAtorNoProjeto,
        papelPedidoNoProjeto: papel,
      })
    ) {
      throw new ForbiddenException(MENSAGEM_TETO_AUTO_REBAIXAMENTO);
    }

    return this.projects.addMember(projectId, alvoId, papel);
  }
}
