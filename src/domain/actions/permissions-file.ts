export type PermissionPolicy = 'auto_approve' | 'require_approval' | 'deny';

/**
 * Conteúdo de permissions.json, o arquivo físico na raiz do workspace do
 * projeto (substitui o antigo `projects.permissions` jsonb). Padrões têm a
 * forma "Terminal(pnpm test:*)" — ver command-matcher.ts pro parsing/match.
 */
export interface PermissionsFile {
  allow: string[];
  deny: string[];
  ask: string[];
}

export const EMPTY_PERMISSIONS_FILE: PermissionsFile = {
  allow: [],
  deny: [],
  ask: [],
};
