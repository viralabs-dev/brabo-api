import type { PrGateStatus } from './pr-gate-state-machine';

// Artefato de infra (Fase 4a — InfraAgent): PR de Dockerfiles/compose/CI
// aberta pelo InfraAgent, gated pelos MESMOS QA/SecOps do dev — mas sem
// task/story/worktree por trás (os arquivos nascem como conteúdo direto,
// nunca tocam um worktree, igual ADR). Tabela paralela leve a `tasks`,
// reaproveitando a MESMA `nextGateStatus` (pr-gate-state-machine.ts).
export interface InfraArtifact {
  id: string;
  projectId: string;
  sessionId: string;
  title: string;
  // Id da proposed_action `open_infra_pr` que abriu esta PR — é o que o
  // engine conhece de volta (resposta de propose_action), não um id de
  // artefato à parte.
  prActionId: string;
  gateStatus: PrGateStatus;
  gateCorrectionCount: number;
  blocked: boolean;
  blockedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}
