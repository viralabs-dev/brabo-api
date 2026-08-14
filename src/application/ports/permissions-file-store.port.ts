import type { PermissionsFile } from '../../domain/actions/permissions-file';
import type { ProjectWorkspaceLocation } from '../../domain/iam/project.entity';

/**
 * Não é um repositório de domínio (não fala com o Postgres) — é o acesso ao
 * permissions.json físico na raiz do workspace do projeto. Abstraído atrás
 * de uma porta pelo mesmo motivo que qualquer infra de borda: testável sem
 * tocar disco de verdade.
 *
 * Recebe a LOCALIZAÇÃO do workspace (RN-169), não `projectId` e não mais só o
 * `workspaceDirName`: desde o ADR 0072 a pasta do projeto pode ser a gerenciada
 * (`container`) ou uma pasta do usuário (`local`), e é o par (modo, caminho)
 * que responde onde o arquivo mora. Quem chama busca o projeto e passa o
 * próprio `project`, que satisfaz a forma — nunca o id cru (ver
 * `project-workspaces-root.ts`).
 */
export abstract class PermissionsFileStore {
  abstract read(local: ProjectWorkspaceLocation): Promise<PermissionsFile>;
  abstract write(
    local: ProjectWorkspaceLocation,
    file: PermissionsFile,
  ): Promise<void>;

  /** Read-modify-write idempotente — não duplica se o padrão já estiver na lista. */
  abstract addPattern(
    local: ProjectWorkspaceLocation,
    list: keyof PermissionsFile,
    pattern: string,
  ): Promise<void>;
}
