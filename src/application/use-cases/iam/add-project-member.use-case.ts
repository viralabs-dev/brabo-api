import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import { WorkspaceRepository } from '../../ports/workspace-repository.port';
import { ResolveEffectiveRoleUseCase } from './resolve-effective-role.use-case';
import {
  MENSAGEM_TETO_AUTO_PROMOCAO,
  MENSAGEM_TETO_AUTO_REBAIXAMENTO,
  MENSAGEM_TETO_OWNER_DO_WORKSPACE,
  autoMovimentoDoProprioPapel,
  rebaixaOwnerDoWorkspace,
} from '../../../domain/iam/tetos-de-rebaixamento';
import type { Role } from '../../../domain/iam/role';

/**
 * Associa (ou re-associa, é upsert) alguém ao projeto, aplicando os dois tetos
 * de rebaixamento antes de escrever (ADR 0127, RN-472).
 *
 * Desde o ADR 0157 (RN-557) o teto 2 recusa o movimento sobre o próprio papel
 * nos DOIS sentidos, e não só para baixo: a auto-PROMOÇÃO que o ADR 0127
 * declarou como capacidade que ficava é brecha, e fecha. Por isso a chamada
 * aqui é ao classificador `autoMovimentoDoProprioPapel` e não a
 * `ehAutoRebaixamento` — o sentido é o que escolhe a mensagem.
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
    const movimento = autoMovimentoDoProprioPapel({
      atorId,
      alvoId,
      papelEfetivoDoAtor: papelEfetivoDoAtorNoProjeto,
      papelPedido: papel,
    });
    if (movimento === 'rebaixamento') {
      throw new ForbiddenException(MENSAGEM_TETO_AUTO_REBAIXAMENTO);
    }
    if (movimento === 'promocao') {
      throw new ForbiddenException(MENSAGEM_TETO_AUTO_PROMOCAO);
    }

    return this.projects.addMember(projectId, alvoId, papel);
  }
}
