import type { FailureOrigin } from './failure-origin';

// Desfecho de UMA delegação de área (Fase 8b QA, Fase 8c Infra — ADR 0038).
// Sem status `pending`: o lead resolve cada delegação síncrona, numa rodada
// só, e só registra o desfecho FINAL — nunca visível como handoff (ver
// handoff.entity.ts), nunca observável fora da área.
export type DelegationStatus = 'completed' | 'failed' | 'dispensed';

export interface Delegation {
  id: string;
  projectId: string;
  sessionId: string;
  // `null` pra áreas sem task de backlog por trás (Infra, Fase 8c — a
  // delegação é sobre a SESSÃO, não sobre uma task). QA (Fase 8b) sempre
  // preenche.
  taskId: string | null;
  area: string;
  leadAgent: string;
  subagent: string;
  status: DelegationStatus;
  parecerArtifactId: string | null;
  failureOrigin: FailureOrigin | null;
  failureReason: string | null;
  justification: string | null;
  createdAt: Date;
}
