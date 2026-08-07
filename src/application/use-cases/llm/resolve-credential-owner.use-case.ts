import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import { WorkspaceRepository } from '../../ports/workspace-repository.port';

/**
 * De quem é a chave que um AGENTE gasta.
 *
 * Credencial de LLM pertence a uma PESSOA (`user_credentials.user_id`), mas
 * agente não é pessoa. Os turnos de agente resolviam isso passando o próprio
 * slug (`agentId ?? sessionId`) na coluna de usuário — a consulta ia ao banco
 * com `user_id = 'criativo'`, o Postgres recusava o UUID inválido, e o erro
 * virava resposta VAZIA no fio. O efeito prático, descoberto só numa execução
 * real: **nenhum agente jamais usou um provider com credencial**. Só `ollama`
 * funcionava, porque para ele a busca é pulada.
 *
 * A resposta é o **owner do workspace** — quem banca a conta banca os agentes,
 * e isso não muda quando outra pessoa abre a sessão. `workspaces.created_by` é
 * a escolha determinística: `workspace_members` pode ter vários `owner`, e
 * "qualquer um deles" faria a chave usada variar sem ninguém decidir.
 */
@Injectable()
export class ResolveCredentialOwnerUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly workspaces: WorkspaceRepository,
  ) {}

  async execute(projectId: string): Promise<string> {
    const project = await this.projects.findById(projectId);
    if (!project) {
      throw new NotFoundException(`Projeto não encontrado: ${projectId}`);
    }

    const workspace = await this.workspaces.findById(project.workspaceId);
    if (!workspace) {
      throw new NotFoundException(
        `Workspace não encontrado: ${project.workspaceId}`,
      );
    }

    return workspace.createdBy;
  }
}
