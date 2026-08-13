import type { PermissionPolicy } from '../../domain/actions/permissions-file';

export abstract class AgentAutonomyRepository {
  /**
   * null = sem linha configurada (nem específica, nem curinga) — decide() não
   * usa este estágio pra nada.
   *
   * Resolve também a regra curinga `actionType === '*'` ("auto mode",
   * RN-153): sem regra específica pro `actionType` pedido, cai para ela.
   * Regra específica sempre vence a curinga.
   */
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
