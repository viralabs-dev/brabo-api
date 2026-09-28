/**
 * A TITULARIDADE do workspace (ADR 0173, RN-616) — `workspaces.created_by`.
 *
 * O nome da coluna diz "quem criou", mas o que o produto LÊ dela é outra
 * coisa: de quem é a credencial de LLM que os agentes gastam e a de git que as
 * ações de agente usam (RN-058, `ResolveCredentialOwnerUseCase`), e de quem é o
 * relatório de gasto (RN-060). Ela NÃO decide autorização — quem autoriza é
 * `workspace_members.role` (ADR 0127) —, e por isso "titular" e "owner" são
 * coisas diferentes: todo workspace pode ter vários owners e tem UM titular.
 *
 * Duas regras, as duas decisão do mantenedor (AT-115):
 *
 * 1. o titular NÃO sai do workspace pela remoção de membro enquanto for
 *    titular: removê-lo deixaria os agentes gastando a credencial de quem já
 *    não está ali, e o relatório de gasto sem ninguém que o leia. 409 nomeado;
 * 2. a titularidade se TRANSFERE, e só para quem já é `owner` do workspace —
 *    ser titular é pagar, e pagar pelo workspace é coisa de dono.
 *
 * Textos e predicado puros; quem traduz para HTTP é o caso de uso.
 */

export const CODIGO_CRIADOR_DO_WORKSPACE = 'criador_do_workspace';

export const MENSAGEM_CRIADOR_DO_WORKSPACE =
  'Não é possível remover o titular do workspace: a credencial de LLM que os ' +
  'agentes gastam, a de git das ações de agente e o relatório de gasto são ' +
  'dele (RN-058/RN-060). Transfira antes a titularidade para outro owner ' +
  '(PUT /workspaces/:workspaceId/owner-of-record) e remova depois.';

export const CODIGO_TITULAR_PRECISA_SER_OWNER = 'titular_precisa_ser_owner';

export const MENSAGEM_TITULAR_PRECISA_SER_OWNER =
  'A titularidade só vai para quem já é owner deste workspace: o titular paga ' +
  'o que os agentes gastam (RN-058). Promova a pessoa a owner antes, ou ' +
  'escolha outro owner.';

/** O alvo da remoção é o titular? Quem remove não importa: a regra é do alvo. */
export function removeOTitular(alvoId: string, titularId: string): boolean {
  return alvoId === titularId;
}
