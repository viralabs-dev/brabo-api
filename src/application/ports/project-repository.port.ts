import type {
  Project,
  ProjectWorkspaceMode,
  StoryPromotionMode,
} from '../../domain/iam/project.entity';
import type {
  ProjectMember,
  ProjectMemberWithUser,
} from '../../domain/iam/project-member.entity';
import type { Role } from '../../domain/iam/role';

export interface ProjectInput {
  name: string;
  slug: string;
  // Teto de tokens por task dos dev agents (micro-USD); nulo/omitido usa o
  // default do domínio.
  taskBudgetMicros?: number | null;
  // Circuit breaker por dev agent (Fase 12b — RN-047); nulo/omitido usa o
  // default do domínio.
  maxConsecutiveBlocked?: number | null;
  // Quem promove story a `ready` (Fase 12c — RN-048). Omitido na criação usa
  // o default da coluna (`manual`).
  storyPromotion?: StoryPromotionMode;
  // ONDE o código mora (RN-169, ADR 0072). Omitido na criação usa o default
  // da coluna (`container`) — o comportamento de sempre.
  workspaceMode?: ProjectWorkspaceMode;
  // Caminho absoluto da pasta do usuário; só com `workspaceMode: 'local'`, e
  // validado pelo CreateProjectUseCase antes de chegar aqui (RN-170).
  workspacePath?: string | null;
}

export abstract class ProjectRepository {
  // `id` e `workspaceDirName` chegam PRONTOS de quem chama (CreateProjectUseCase):
  // o nome da pasta se compõe do id ANTES de o projeto existir, então o id não
  // pode vir do `defaultRandom()` do Postgres — é gerado em código
  // (`crypto.randomUUID()`) para o use case poder montar `workspaceDirName`
  // na mesma chamada.
  abstract create(
    input: ProjectInput & {
      id: string;
      workspaceId: string;
      createdBy: string;
      workspaceDirName: string;
    },
  ): Promise<Project>;
  abstract findById(id: string): Promise<Project | null>;
  abstract listForWorkspace(workspaceId: string): Promise<Project[]>;
  abstract update(
    id: string,
    input: Partial<ProjectInput>,
  ): Promise<Project | null>;
  abstract remove(id: string): Promise<Project | null>;
  abstract addMember(
    projectId: string,
    userId: string,
    role: Role,
  ): Promise<ProjectMember>;
  abstract findMemberRole(
    projectId: string,
    userId: string,
  ): Promise<Role | null>;
  abstract listMembers(projectId: string): Promise<ProjectMemberWithUser[]>;
  abstract removeMember(projectId: string, userId: string): Promise<void>;
}
