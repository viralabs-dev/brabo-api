import type { SessionStatus } from './session-state-machine';

export interface Session {
  id: string;
  projectId: string;
  createdBy: string;
  status: SessionStatus;
  nextSeq: number;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
  // Fase 4b — Psicólogo: motivo reportado pelo engine na transição pra um
  // estado terminal (heartbeat_timeout/killed/exceção/...); null pra
  // fechamento humano/gracioso ou sessão ainda não terminal.
  terminationReason: string | null;
  // Fase 5 — OpenTelemetry: `traceparent` W3C da span raiz da sessão, aberta
  // na criação. Todo trabalho da sessão (na api e no engine) pendura suas spans
  // neste valor, e é ele que torna a sessão recuperável no Tempo por um id só.
  traceParent: string | null;
}
