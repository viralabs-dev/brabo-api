import type { Workspace } from '../../domain/iam/workspace.entity';
import type {
  WorkspaceMember,
  WorkspaceMemberWithUser,
} from '../../domain/iam/workspace-member.entity';
import type { Role } from '../../domain/iam/role';

export interface WorkspaceInput {
  name: string;
  slug: string;
}

export interface WorkspaceWithRole {
  workspace: Workspace;
  role: Role;
}

export abstract class WorkspaceRepository {
  abstract create(
    input: WorkspaceInput & { createdBy: string },
  ): Promise<Workspace>;
  abstract addMember(
    workspaceId: string,
    userId: string,
    role: Role,
  ): Promise<WorkspaceMember>;
  abstract findById(id: string): Promise<Workspace | null>;
  abstract listForUser(userId: string): Promise<WorkspaceWithRole[]>;
  abstract update(
    id: string,
    input: Partial<WorkspaceInput>,
  ): Promise<Workspace | null>;
  abstract remove(id: string): Promise<Workspace | null>;
  /**
   * Apaga a linha de `workspace_members` e diz se havia uma (ADR 0173,
   * RN-615). Só a linha: a cascata sobre projetos e chaves é do caso de uso.
   */
  abstract removeMember(workspaceId: string, userId: string): Promise<boolean>;
  /**
   * Grava o TITULAR (`workspaces.created_by`) e devolve o workspace, ou `null`
   * se não existe (ADR 0173, RN-616). Sem checagem: quem decide se o destino
   * pode ser titular é o caso de uso.
   */
  abstract transferirTitularidade(
    id: string,
    userId: string,
  ): Promise<Workspace | null>;
  /** Liga/desliga o roteamento de ferramenta pelo Jev (ADR 0179); `null` se o workspace não existe. */
  abstract setToolRouterEnabled(
    id: string,
    enabled: boolean,
  ): Promise<Workspace | null>;

  /**
   * Os membros do workspace com nome e e-mail (AT-335, RN-652). Só id, nome,
   * e-mail e papel — a mesma forma de `ProjectRepository.listMembers`.
   */
  abstract listMembers(workspaceId: string): Promise<WorkspaceMemberWithUser[]>;
  abstract findMemberRole(
    workspaceId: string,
    userId: string,
  ): Promise<Role | null>;
}
