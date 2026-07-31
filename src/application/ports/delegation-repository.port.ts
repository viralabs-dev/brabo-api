import type {
  Delegation,
  DelegationStatus,
} from '../../domain/agents/delegation.entity';
import type { FailureOrigin } from '../../domain/agents/failure-origin';

export interface NewDelegation {
  projectId: string;
  sessionId: string;
  taskId?: string | null;
  area: string;
  leadAgent: string;
  subagent: string;
  status: DelegationStatus;
  parecerArtifactId?: string | null;
  failureOrigin?: FailureOrigin | null;
  failureReason?: string | null;
  justification?: string | null;
}

export abstract class DelegationRepository {
  abstract create(input: NewDelegation): Promise<Delegation>;
  abstract findByTask(taskId: string): Promise<Delegation[]>;
}
