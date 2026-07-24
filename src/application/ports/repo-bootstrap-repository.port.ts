import type {
  BootstrapStepName,
  BootstrapStepStatus,
  RepoBootstrap,
} from '../../domain/git/repo-bootstrap.entity';

export interface NewRepoBootstrap {
  projectId: string;
  sessionId: string;
}

export interface RepoBootstrapPatch {
  step: BootstrapStepName;
  status: BootstrapStepStatus;
  attempts: number;
  lastError: string | null;
}

export abstract class RepoBootstrapRepository {
  abstract create(input: NewRepoBootstrap): Promise<RepoBootstrap>;
  abstract findByProjectId(projectId: string): Promise<RepoBootstrap | null>;
  abstract update(
    projectId: string,
    patch: RepoBootstrapPatch,
  ): Promise<RepoBootstrap>;
}
