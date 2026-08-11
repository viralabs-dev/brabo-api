import type { PermissionsFile } from '../../domain/actions/permissions-file';

/**
 * Não é um repositório de domínio (não fala com o Postgres) — é o acesso ao
 * permissions.json físico na raiz do workspace do projeto. Abstraído atrás
 * de uma porta pelo mesmo motivo que qualquer infra de borda: testável sem
 * tocar disco de verdade.
 *
 * Recebe `workspaceDirName` (RN-109), não `projectId`: o nome da pasta física
 * é dado, congelado na criação do projeto, e quem chama busca o projeto e
 * passa `project.workspaceDirName` — nunca o id cru (ver
 * `project-workspaces-root.ts`).
 */
export abstract class PermissionsFileStore {
  abstract read(workspaceDirName: string): Promise<PermissionsFile>;
  abstract write(
    workspaceDirName: string,
    file: PermissionsFile,
  ): Promise<void>;

  /** Read-modify-write idempotente — não duplica se o padrão já estiver na lista. */
  abstract addPattern(
    workspaceDirName: string,
    list: keyof PermissionsFile,
    pattern: string,
  ): Promise<void>;
}
