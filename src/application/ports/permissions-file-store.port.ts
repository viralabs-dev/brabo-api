import type { PermissionsFile } from '../../domain/actions/permissions-file';

/**
 * Não é um repositório de domínio (não fala com o Postgres) — é o acesso ao
 * permissions.json físico na raiz do workspace do projeto. Abstraído atrás
 * de uma porta pelo mesmo motivo que qualquer infra de borda: testável sem
 * tocar disco de verdade.
 */
export abstract class PermissionsFileStore {
  abstract read(projectId: string): Promise<PermissionsFile>;
  abstract write(projectId: string, file: PermissionsFile): Promise<void>;

  /** Read-modify-write idempotente — não duplica se o padrão já estiver na lista. */
  abstract addPattern(
    projectId: string,
    list: keyof PermissionsFile,
    pattern: string,
  ): Promise<void>;
}
