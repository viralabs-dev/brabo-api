import type {
  Handoff,
  HandoffStatus,
} from '../../domain/sessions/handoff.entity';

export interface NewHandoff {
  sessionId: string;
  projectId: string;
  fromAgent: string;
  toAgent: string;
  artifactId?: string | null;
  status?: HandoffStatus;
}

export abstract class HandoffRepository {
  abstract create(input: NewHandoff): Promise<Handoff>;
  abstract findById(id: string): Promise<Handoff | null>;
  abstract findBySession(sessionId: string): Promise<Handoff[]>;
  abstract updateStatus(id: string, status: HandoffStatus): Promise<Handoff>;
}
