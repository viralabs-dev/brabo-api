import { roleAtLeast, type Role } from './role';

/**
 * Os DOIS tetos de rebaixamento de `project_members` (ADR 0127, RN-472).
 *
 * A linha de projeto SOBREPÕE a de workspace nos dois sentidos —
 * `ResolveEffectiveRoleUseCase.forProject` é `projectRole ?? workspaceRole`, e
 * continua sendo (RN-471). Isso é capacidade deliberada: restringir alguém num
 * projeto sensível (workspace `developer` → `viewer` no projeto X) é coisa que
 * o produto sabe fazer e vai seguir sabendo. O que a sobreposição NÃO pode
 * fazer são dois movimentos, e é isso que este módulo recusa.
 *
 * São TETOS na acepção que o repositório já usa em `domain/actions/decide.ts`
 * (RN-154/RN-418): regra que nem a política afrouxa, sem chave de configuração,
 * avaliada por último e independente do papel de quem chama. A diferença é o
 * mecanismo — lá o desfecho é `require_approval` sobre uma `proposed_action` de
 * agente, aqui é 403 sobre uma chamada HUMANA e síncrona, que não tem fila de
 * aprovação para cair. A FORMA é a mesma de propósito: função pura, no domínio,
 * com a mensagem ao lado da condição.
 *
 * As duas funções são puras e não sabem de HTTP: quem traduz para 403 é o caso
 * de uso.
 */

export const MENSAGEM_TETO_OWNER_DO_WORKSPACE =
  'Não é possível rebaixar quem é owner do workspace: o papel de projeto ' +
  'sobrepõe o de workspace, e isto tiraria do dono o acesso ao próprio ' +
  'projeto. Mude o papel dele no workspace, se é isso que se quer.';

export const MENSAGEM_TETO_AUTO_REBAIXAMENTO =
  'Você não pode rebaixar a si mesmo neste projeto: desfazer exige o papel ' +
  'que você estaria abandonando. Peça a outro maintainer.';

/**
 * TETO 1 — ninguém rebaixa quem é `owner` do WORKSPACE.
 *
 * O `owner` é lido de `workspace_members.role`, NUNCA de `workspaces.created_by`
 * (ver o ADR): quem autoriza no resto do sistema é o papel, e o criador é um
 * fato histórico que a transferência de propriedade não atualiza.
 *
 * Só o REBAIXAMENTO é recusado. Gravar `owner` de projeto para quem já é
 * `owner` de workspace é redundante, não perigoso, e passa.
 */
export function rebaixaOwnerDoWorkspace(
  papelDoAlvoNoWorkspace: Role | null,
  papelPedidoNoProjeto: Role,
): boolean {
  if (papelDoAlvoNoWorkspace !== 'owner') return false;
  return !roleAtLeast(papelPedidoNoProjeto, 'owner');
}

/**
 * TETO 2 — ninguém rebaixa a SI MESMO.
 *
 * A formulação é essa, sem limiar: não é "não se rebaixe abaixo de
 * `maintainer`". As duas recusam o movimento perigoso (perder o papel que
 * desfaz o próprio movimento), mas "abaixo de `maintainer`" só está certa
 * enquanto `@RequireRole('maintainer')` for o que a rota pede — é uma regra de
 * domínio que copia um número de um decorator de controller, e envelhece calada
 * se ele mudar. "Ninguém rebaixa a si mesmo" se enuncia numa cláusula, não tem
 * número para envelhecer, e é a MESMA forma do teto 1 (quem, não quanto).
 *
 * O preço é um movimento inofensivo que também cai: um `owner` se pondo como
 * `maintainer` no próprio projeto seria reversível, e passa a ser recusado.
 * Ele continua alcançável — por outro `maintainer` — e o custo de enunciar a
 * regra com exceção é maior que o de perdê-lo.
 *
 * SUBIR o próprio papel não é rebaixamento e segue passando; este teto não
 * abre essa questão (ver Consequences do ADR 0127).
 */
export function ehAutoRebaixamento(movimento: {
  atorId: string;
  alvoId: string;
  papelEfetivoDoAtorNoProjeto: Role | null;
  papelPedidoNoProjeto: Role;
}): boolean {
  const { atorId, alvoId, papelEfetivoDoAtorNoProjeto, papelPedidoNoProjeto } =
    movimento;

  if (atorId !== alvoId) return false;
  // Sem papel efetivo não há de onde descer. Inalcançável pelo HTTP (o
  // `RolesGuard` já recusou), mas a função é pura e não presume o chamador.
  if (papelEfetivoDoAtorNoProjeto === null) return false;
  return !roleAtLeast(papelPedidoNoProjeto, papelEfetivoDoAtorNoProjeto);
}
