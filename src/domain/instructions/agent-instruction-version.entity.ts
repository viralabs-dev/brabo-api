// Uma versão histórica de uma instrução de agente (Fase 4b). Append-only:
// nem patch nem rollback apagam linha — rollback grava uma versão NOVA
// com o conteúdo antigo. `sourceHypothesisId` é o elo final da
// rastreabilidade hipótese→patch→versão.
export interface AgentInstructionVersion {
  id: string;
  projectId: string;
  agent: string;
  version: number;
  content: string;
  createdBy: string | null;
  sourceActionId: string | null;
  sourceHypothesisId: string | null;
  note: string | null;
  createdAt: Date;
}
