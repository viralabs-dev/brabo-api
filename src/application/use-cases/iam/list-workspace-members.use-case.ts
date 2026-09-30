import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkspaceRepository } from '../../ports/workspace-repository.port';

/**
 * Os membros do WORKSPACE com nome e e-mail (AT-335, RN-652).
 *
 * Irmão de `ListProjectMembersUseCase`: quem entra num projeto só pelo papel
 * de workspace não tem linha em `project_members`, e o fio da sessão o
 * chamava de "outro membro" por não ter de onde ler o nome. A leitura devolve
 * a MESMA forma da de projeto — id, nome, e-mail e papel —, e nada além.
 */
@Injectable()
export class ListWorkspaceMembersUseCase {
  constructor(private readonly workspaces: WorkspaceRepository) {}

  async execute(workspaceId: string) {
    const workspace = await this.workspaces.findById(workspaceId);
    if (!workspace) throw new NotFoundException('Workspace não encontrado');
    return this.workspaces.listMembers(workspaceId);
  }
}
