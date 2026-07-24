import type { InfraArtifact } from '../../domain/execution/infra-artifact.entity';
import type { PrGateStatus } from '../../domain/execution/pr-gate-state-machine';

export interface NewInfraArtifact {
  projectId: string;
  sessionId: string;
  title: string;
  prActionId: string;
}

export abstract class InfraArtifactRepository {
  // Criado já com gateStatus 'awaiting_qa' — diferente de Task (que existe
  // ANTES da PR e abre o gate depois via `openGate`), o artefato de infra só
  // nasce quando a PR já foi aberta (ver ExecuteInfraPrUseCase).
  abstract create(input: NewInfraArtifact): Promise<InfraArtifact>;
  abstract findById(id: string): Promise<InfraArtifact | null>;
  // O engine só conhece de volta o id da proposed_action `open_infra_pr`
  // (resposta de propose_action) — não um id de artefato à parte.
  abstract findByPrActionId(prActionId: string): Promise<InfraArtifact | null>;
  // Uma sessão só produz UM ciclo de PR de infra (o InfraAgent corrige na
  // MESMA branch/PR em vez de abrir uma nova) — usado por
  // ExecuteInfraPrUseCase pra distinguir a proposta inicial (cria branch+PR)
  // de uma correção (só commita, reaproveita branch+PR existentes).
  abstract findBySessionId(sessionId: string): Promise<InfraArtifact | null>;
  // Lista pro painel humano (Fase 4a) — seção "PRs de infra em revisão" da
  // tab Aprovações, mesmo espírito de `listByProjectAndType` pras ADRs.
  abstract listByProject(projectId: string): Promise<InfraArtifact[]>;
  abstract updateGateStatus(
    id: string,
    gateStatus: PrGateStatus,
    correctionCount: number,
  ): Promise<InfraArtifact>;
  abstract markBlocked(
    id: string,
    reason: string,
    diagnosis: string,
  ): Promise<InfraArtifact>;
}
