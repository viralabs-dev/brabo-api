import type { Actor } from '../sessions/session-event.entity';
import type { ActionStatus } from './action-state-machine';
import type { PermissionPolicy } from './permissions-file';
import type { TerminalExecutionResult } from './terminal-execution-result';
import type { GitBootstrapExecutionResult } from '../git/bootstrap-execution-result';
import type { AdrPrExecutionResult } from '../git/adr-pr-execution-result';
import type { GitActionExecutionResult } from '../git/git-action-execution-result';
import type { InfraPrExecutionResult } from '../git/infra-pr-execution-result';
import type { InstructionPatchExecutionResult } from '../instructions/instruction-patch-execution-result';
import type { ContainerStartExecutionResult } from '../containers/container-start-execution-result';

export interface ProposedAction {
  id: string;
  projectId: string;
  sessionId: string;
  seq: number;
  actionType: string;
  payload: unknown;
  status: ActionStatus;
  resolvedPolicy: PermissionPolicy;
  actor: Actor;
  decidedBy: string | null;
  decidedAt: Date | null;
  rejectionReason: string | null;
  executionResult:
    | TerminalExecutionResult
    | GitBootstrapExecutionResult
    | AdrPrExecutionResult
    | GitActionExecutionResult
    | InfraPrExecutionResult
    | InstructionPatchExecutionResult
    | ContainerStartExecutionResult
    | null;
  createdAt: Date;
  updatedAt: Date;
}
