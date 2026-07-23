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
}
