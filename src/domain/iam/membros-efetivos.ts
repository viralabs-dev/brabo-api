import type { ProjectMemberWithUser } from './project-member.entity';
import type { WorkspaceMemberWithUser } from './workspace-member.entity';

/**
 * Quem é membro de um projeto, e com que papel, pela MESMA regra da
 * autorização (RN-471): `projectRole ?? workspaceRole` — a linha de
 * `project_members` sobrepõe a de `workspace_members` nos dois sentidos, e
 * quem só tem papel no workspace é membro do projeto com esse papel.
 *
 * Existe por causa da Anamnese (RN-680): ela lia só `project_members`, e criar
 * projeto não grava linha ali — o dono do workspace que criou e usou o projeto
 * não era "membro elegível", e as seis rodadas do uso real de 29/09 chamaram o
 * LLM para concluir "nenhum membro elegível". A ordem do resultado é a da
 * linha de projeto primeiro, depois a de workspace, sem repetição.
 */
export function membrosEfetivos(
  doProjeto: readonly ProjectMemberWithUser[],
  doWorkspace: readonly WorkspaceMemberWithUser[],
): ProjectMemberWithUser[] {
  const vistos = new Set(doProjeto.map((m) => m.userId));
  return [
    ...doProjeto,
    ...doWorkspace
      .filter((m) => !vistos.has(m.userId))
      .map((m) => ({
        userId: m.userId,
        role: m.role,
        name: m.name,
        email: m.email,
      })),
  ];
}
