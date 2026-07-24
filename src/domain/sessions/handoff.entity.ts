import type { HandoffStatus } from './agent-activation';

export type { HandoffStatus };

// Handoff entre agentes numa sessão (Fase 3b). Status é mutável (a fonte da
// verdade do estado corrente); cada transição também é registrada como um
// session_event `handoff.*` imutável no event log.
export interface Handoff {
  id: string;
  sessionId: string;
  projectId: string;
  fromAgent: string;
  toAgent: string;
  artifactId: string | null;
  status: HandoffStatus;
  createdAt: Date;
  updatedAt: Date;
}
