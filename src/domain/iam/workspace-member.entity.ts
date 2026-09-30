import type { Role } from './role';

export interface WorkspaceMember {
  workspaceId: string;
  userId: string;
  role: Role;
  createdAt: Date;
}

/**
 * Membro do workspace já com nome e e-mail (AT-335, RN-652): a leitura que a
 * tela usa para NOMEAR quem entra num projeto só pelo papel de workspace. A
 * forma é a de `ProjectMemberWithUser`, de propósito — sem `createdAt`, sem
 * nada além de id, nome, e-mail e papel.
 */
export interface WorkspaceMemberWithUser {
  userId: string;
  role: Role;
  name: string | null;
  email: string;
}
