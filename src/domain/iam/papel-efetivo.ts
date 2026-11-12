import type { Role } from './role';

/**
 * O papel efetivo num projeto (RN-471): a linha de projeto SOBREPÕE a de
 * workspace nos dois sentidos — nunca "o maior dos dois". Régua única, usada
 * por `ResolveEffectiveRoleUseCase.forProject` e pela leitura em lote da
 * Caixa de decisões (RN-1195).
 */
export function papelEfetivo(
  projectRole: Role | null | undefined,
  workspaceRole: Role | null | undefined,
): Role | null {
  return projectRole ?? workspaceRole ?? null;
}
