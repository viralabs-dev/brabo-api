import type {
  BootstrapPlan,
  BootstrapPlanDecision,
  BootstrapStepName,
  BootstrapStepStatus,
  RepoBootstrap,
  RepoOrigin,
} from '../../domain/git/repo-bootstrap.entity';

export interface NewRepoBootstrap {
  projectId: string;
  sessionId: string;
  /** Ausente = `created`, o caminho de provisionamento normal (Fase 12a). */
  origin?: RepoOrigin;
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
  /**
   * Grava o snapshot do dry-run. NUNCA toca a decisão — readotar
   * regenera o plano sem apagar uma decisão que já existia (Fase 12a).
   */
  abstract savePlan(
    projectId: string,
    plan: BootstrapPlan,
  ): Promise<RepoBootstrap>;
  /** Registra a decisão do usuário sobre o plano — o portão da RN-045. */
  abstract recordPlanDecision(
    projectId: string,
    decision: BootstrapPlanDecision,
    decidedBy: string,
  ): Promise<RepoBootstrap>;
}
