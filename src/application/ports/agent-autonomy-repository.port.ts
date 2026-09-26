import type { AutonomyOrigin } from '../../domain/actions/decide';
import type { PermissionPolicy } from '../../domain/actions/permissions-file';

/** A regra de autonomia resolvida e de ONDE ela veio (RN-603). */
export interface AutonomiaResolvida {
  mode: PermissionPolicy;
  origem: AutonomyOrigin;
}

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

  /**
   * A MESMA resolução de `findMode` (específica vence a curinga), devolvendo
   * também a origem — é o que `decide()` precisa para reconhecer o "modo
   * automático" (RN-603, ADR 0167). `findMode` é leitura desta; não há uma
   * segunda régua de precedência.
   */
  abstract resolve(
    projectId: string,
    agentId: string,
    actionType: string,
  ): Promise<AutonomiaResolvida | null>;

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
