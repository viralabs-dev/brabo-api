import type { RecursosDoContainer } from '../../domain/containers/project-container';
import type {
  ContainerLifecycleStatus,
  ProjectContainerLifecycle,
} from '../../domain/containers/container-lifecycle';

export interface CreateContainerLifecycleInput {
  projectId: string;
  imageVersion: number;
  resources: RecursosDoContainer;
}

export interface UpdateContainerLifecycleInput {
  /** `undefined` não mexe na coluna; `null` limpa explicitamente. */
  containerId?: string | null;
  failureReason?: string | null;
}

/**
 * O ESTADO do container de um projeto (ADR 0081) — distinto de
 * `SessionEventRepository`, que guarda a DECISÃO de imagem do Arquiteto
 * (ADR 0065). Uma linha por projeto: `findByProject`/`create` tratam
 * `project_id` como chave, e `create` falha (constraint única no banco) se
 * chamado duas vezes para o mesmo projeto — quem quer transicionar depois
 * de a linha existir usa `updateStatus`.
 */
export abstract class ContainerRepository {
  abstract findByProject(
    projectId: string,
  ): Promise<ProjectContainerLifecycle | null>;

  /** SELECT ... FOR UPDATE — só faz sentido dentro de UnitOfWork.runInTransaction. */
  abstract findByProjectForUpdate(
    projectId: string,
  ): Promise<ProjectContainerLifecycle | null>;

  /** Nasce sempre em `provisioning` — é o único estado inicial válido. */
  abstract create(
    input: CreateContainerLifecycleInput,
  ): Promise<ProjectContainerLifecycle>;

  abstract updateStatus(
    id: string,
    status: ContainerLifecycleStatus,
    patch?: UpdateContainerLifecycleInput,
  ): Promise<ProjectContainerLifecycle>;
}
