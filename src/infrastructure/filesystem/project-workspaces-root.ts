import { join } from 'node:path';

/**
 * A raiz dos workspaces de projeto no disco, compartilhada com o engine pelo
 * mesmo volume (ver `PROJECT_WORKSPACES_ROOT` em configuration.md).
 *
 * Existe como função única porque DOIS consumidores dependem dela concordarem:
 * o `permissions.json` é lido de `<raiz>/<projectId>/permissions.json`, e o
 * escopo de caminho do ADR 0055 autoriza comandos sob `<raiz>/<projectId>`.
 * Se as duas derivações divergissem, a política seria lida de um lugar e
 * aplicada a outro — falha silenciosa e difícil de enxergar.
 */
export function projectWorkspacesRoot(): string {
  return process.env.PROJECT_WORKSPACES_ROOT ?? '/tmp/brabo-project-workspaces';
}

/** A pasta do projeto — o que o ADR 0055 chama de escopo. */
export function projectScopeRoot(projectId: string): string {
  return join(projectWorkspacesRoot(), projectId);
}
