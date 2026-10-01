import type { AutonomyOrigin } from '../../domain/actions/decide';
import type { PermissionPolicy } from '../../domain/actions/permissions-file';

/** A regra de autonomia resolvida e de ONDE ela veio (RN-603). */
export interface AutonomiaResolvida {
  mode: PermissionPolicy;
  origem: AutonomyOrigin;
  /**
   * O modo da linha ESPECÍFICA do tipo pedido, quando ela existe — mesmo
   * quando quem resolveu foi a curinga (RN-670): é por aqui que "Sempre
   * permitir" sabe que o padrão do agente já está gravado, sem tratar a
   * curinga como se fosse ele.
   */
  especifica: PermissionPolicy | null;
}

export abstract class AgentAutonomyRepository {
  /**
   * null = sem linha configurada (nem específica, nem curinga) — decide() não
   * usa este estágio pra nada.
   *
   * Resolve também a regra curinga `actionType === '*'` ("auto mode",
   * RN-153): sem regra específica pro `actionType` pedido, cai para ela.
   * Regra específica vence a curinga — com UMA exceção (RN-670, ADR 0189):
   * específica `auto_approve` sob curinga `auto_approve` resolve como a
   * CURINGA. As duas dizem o mesmo modo, e a específica não pode desligar o
   * piloto automático que a curinga liga.
   */
  abstract findMode(
    projectId: string,
    agentId: string,
    actionType: string,
  ): Promise<PermissionPolicy | null>;

  /**
   * A MESMA resolução de `findMode` (específica vence a curinga, salvo a
   * exceção da RN-670 acima), devolvendo também a origem — é o que `decide()` precisa para reconhecer o "modo
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
