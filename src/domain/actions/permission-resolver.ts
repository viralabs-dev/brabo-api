export type PermissionPolicy = 'auto_approve' | 'require_approval' | 'deny';

export interface PermissionRule {
  actionType: string; // exato, ou sufixo wildcard "prefixo.*"
  policy: PermissionPolicy;
}

export interface PermissionsConfig {
  rules: PermissionRule[];
}

export const DEFAULT_PERMISSION_POLICY: PermissionPolicy = 'require_approval';

/**
 * Primeira regra do array que casar com actionType vence. Sem regra
 * aplicável, cai no default fixo (não configurável via jsonb).
 */
export function resolvePermission(
  permissions: PermissionsConfig | null | undefined,
  actionType: string,
): PermissionPolicy {
  const rules = permissions?.rules ?? [];
  for (const rule of rules) {
    if (matchesActionType(rule.actionType, actionType)) return rule.policy;
  }
  return DEFAULT_PERMISSION_POLICY;
}

function matchesActionType(pattern: string, actionType: string): boolean {
  if (pattern.endsWith('.*')) {
    return actionType.startsWith(pattern.slice(0, -1));
  }
  return pattern === actionType;
}
