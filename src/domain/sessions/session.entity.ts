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
}
