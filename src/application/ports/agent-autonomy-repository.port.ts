import type { PermissionPolicy } from '../../domain/actions/permissions-file';

export abstract class AgentAutonomyRepository {
  /** null = sem linha configurada — decide() não usa este estágio pra nada. */
  abstract findMode(
    projectId: string,
    agentId: string,
    actionType: string,
  ): Promise<PermissionPolicy | null>;

  abstract upsert(
    projectId: string,
    agentId: string,
    actionType: string,
    mode: PermissionPolicy,
  ): Promise<void>;

  abstract listForProject(
    projectId: string,
  ): Promise<
    Array<{ agentId: string; actionType: string; mode: PermissionPolicy }>
  >;
}
