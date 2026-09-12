import { roleAtLeast, type Role } from './role';

/**
 * Os DOIS tetos de rebaixamento (ADR 0127, RN-472). Nasceram sobre
 * `project_members` e o teto 2 alcança também `workspace_members` desde o ADR
 * 0157 (RN-557); o teto 1 é só do projeto, pelo motivo que está no docblock
 * de `AddWorkspaceMemberUseCase`.
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
 * São DOIS tetos e QUATRO portas: o ADR 0156 (RN-556) acrescentou
 * `remocaoEhAutoRebaixamento`, que é o teto 2 aplicado à REMOÇÃO da linha de
 * projeto, e o ADR 0157 (RN-557) acrescentou a quarta —
 * `POST workspaces/:workspaceId/members`, que era um upsert sem teto nenhum.
 * Nenhuma delas é teto novo: é a mesma regra vista por mais uma porta. Teto
 * novo aqui continua sendo decisão de produto.
 *
 * O ADR 0157 também alargou o teto 2 num SENTIDO: ele passa a recusar a
 * auto-PROMOÇÃO, que o ADR 0127 tinha deixado passar por escrito. Quem sobe é
 * promovido por outra pessoa, pela mesma razão pela qual quem desce é rebaixado
 * por outra pessoa — o movimento sobre o próprio papel não se audita sozinho.
 * Por isso a comparação de papéis virou UM classificador
 * (`autoMovimentoDoProprioPapel`) que devolve o SENTIDO em vez de um booleano:
 * o caso de uso precisa saber qual dos dois bateu para escolher a mensagem, e
 * colapsar os dois faria quem tentou se promover receber a frase de
 * rebaixamento.
 *
 * As funções são puras e não sabem de HTTP: quem traduz para 403 é o caso
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
 * As TRÊS mensagens que o ADR 0157 (RN-557) acrescentou. Os nomes são
 * assimétricos — as de projeto não ganharam sufixo `_NO_PROJETO` — porque as
 * duas primeiras já existiam e são citadas por nome na RN-472, no ADR 0127 e em
 * `docs/security-surface.md`: renomeá-las por simetria trocaria referência de
 * documento por estética.
 *
 * Cada sentido tem frase PRÓPRIA, e cada escopo também. Quem tentou se promover
 * não recebe a frase de rebaixamento (não foi o que ele fez), e quem esbarra no
 * teto do workspace não é mandado falar com um `maintainer` — lá o papel que
 * desfaz é `owner`.
 */
export const MENSAGEM_TETO_AUTO_PROMOCAO =
  'Você não pode promover a si mesmo neste projeto: quem sobe é promovido ' +
  'por outra pessoa. Peça a outro maintainer.';

export const MENSAGEM_TETO_AUTO_REBAIXAMENTO_NO_WORKSPACE =
  'Você não pode rebaixar a si mesmo neste workspace: aqui não há papel ' +
  'acima para segurar a queda, não existe rota que remova membro, e desfazer ' +
  'exige o owner que você estaria abandonando. Peça a outro owner.';

export const MENSAGEM_TETO_AUTO_PROMOCAO_NO_WORKSPACE =
  'Você não pode promover a si mesmo neste workspace: quem sobe é promovido ' +
  'por outro owner.';

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

/** O sentido de um movimento que alguém faz sobre o PRÓPRIO papel. */
export type SentidoDoAutoMovimento = 'rebaixamento' | 'promocao';

/**
 * TETO 2 — ninguém mexe no PRÓPRIO papel, nem para baixo nem para cima.
 *
 * O ADR 0127 nasceu só com a metade de baixo ("ninguém rebaixa a si mesmo") e
 * declarou a de cima como capacidade que ficava: *"auto-PROMOÇÃO. Um
 * `maintainer` pode se gravar como `owner` do projeto (…) os tetos são sobre
 * descer"*. O ADR 0157 (RN-557) REVISA essa frase. As duas metades são o mesmo
 * movimento — uma pessoa decidindo sozinha qual autoridade tem — e a de cima é
 * a que ESCALA privilégio, que a de baixo nunca fez. Quem sobe é promovido por
 * outra pessoa.
 *
 * A formulação continua sem limiar: não é "não se rebaixe abaixo de
 * `maintainer`" nem "não se promova acima de X". "A si mesmo" se enuncia numa
 * cláusula, não tem número para envelhecer quando o `@RequireRole` da rota
 * mudar de mínimo, e é a MESMA forma do teto 1 (quem, não quanto).
 *
 * O preço, declarado nos dois sentidos: caem junto dois movimentos inofensivos
 * — o `owner` se pondo como `maintainer` no próprio projeto (reversível) e o
 * `maintainer` legítimo que precisa de `owner` ali. Os dois seguem alcançáveis
 * por outra pessoa com o papel da rota, e o custo de enunciar a regra com
 * exceção é maior que o de perdê-los.
 *
 * Devolve o SENTIDO, e não um booleano, porque quem chama precisa dele para
 * escolher a mensagem: quem tentou se promover não pode receber a frase de
 * rebaixamento. Reescrever o MESMO papel devolve `null` — é upsert idempotente,
 * não movimento.
 */
export function autoMovimentoDoProprioPapel(movimento: {
  atorId: string;
  alvoId: string;
  papelEfetivoDoAtor: Role | null;
  papelPedido: Role;
}): SentidoDoAutoMovimento | null {
  const { atorId, alvoId, papelEfetivoDoAtor, papelPedido } = movimento;

  if (atorId !== alvoId) return null;
  // Sem papel efetivo não há de onde descer, e qualquer papel é subida — é o
  // caso em que a auto-promoção é máxima (de acesso nenhum a um papel). A
  // assimetria com o `null` de `remocaoEhAutoRebaixamento` é aparente: lá o
  // `null` é o papel DEPOIS, aqui é o de ANTES. Inalcançável pelo HTTP (o
  // `RolesGuard` já recusou), mas a função é pura e não presume o chamador —
  // e é por ela que a CRIAÇÃO de workspace não passa por aqui:
  // `CreateWorkspaceUseCase` grava o criador como `owner` pelo repositório,
  // que é uma auto-promoção legítima e a única que existe no produto.
  if (papelEfetivoDoAtor === null) return 'promocao';
  if (papelPedido === papelEfetivoDoAtor) return null;
  return roleAtLeast(papelPedido, papelEfetivoDoAtor)
    ? 'promocao'
    : 'rebaixamento';
}

/**
 * A metade de BAIXO do teto 2, que é a única que a REMOÇÃO enxerga.
 *
 * Ela sobrevive à unificação do ADR 0157 por um motivo de comportamento, não de
 * compatibilidade: `remocaoEhAutoRebaixamento` delega a esta função, e delegar
 * ao classificador inteiro faria a remoção passar a recusar TAMBÉM a
 * auto-promoção — tirar a própria linha de projeto que restringia alguém eleva
 * o efetivo dele para o papel de workspace, e esse movimento é justamente como
 * se desfaz a restrição que o teto 1 impede de criar (ADR 0156, ponto 3).
 * Alargar o sentido aqui de passagem mudaria uma porta que este ADR não abriu.
 *
 * A comparação NÃO é reescrita: é uma leitura do classificador.
 */
export function ehAutoRebaixamento(movimento: {
  atorId: string;
  alvoId: string;
  papelEfetivoDoAtorNoProjeto: Role | null;
  papelPedidoNoProjeto: Role;
}): boolean {
  const { atorId, alvoId, papelEfetivoDoAtorNoProjeto, papelPedidoNoProjeto } =
    movimento;

  return (
    autoMovimentoDoProprioPapel({
      atorId,
      alvoId,
      papelEfetivoDoAtor: papelEfetivoDoAtorNoProjeto,
      papelPedido: papelPedidoNoProjeto,
    }) === 'rebaixamento'
  );
}

export const MENSAGEM_TETO_AUTO_REBAIXAMENTO_POR_REMOCAO =
  'Você não pode remover a si mesmo deste projeto: sem a linha de projeto ' +
  'seu papel cai para o que você tem no workspace, e voltar exige o papel ' +
  'que você estaria abandonando. Peça a outro maintainer.';

/**
 * TETO 2 pela OUTRA PORTA — a REMOÇÃO da própria linha de projeto (RN-556).
 *
 * O ADR 0127 deixou este movimento de fora por escrito, e a frase que ele usou
 * é a premissa que esta função recusa: "a remoção é sempre benigna" é FALSA.
 * Remover a linha de `project_members` não apaga um papel: ela TROCA o papel
 * efetivo — `projectRole ?? workspaceRole` passa a resolver pelo segundo termo
 * (RN-471) —, e quando o papel de workspace é menor que o de projeto o efeito
 * LÍQUIDO é exatamente o rebaixamento que o teto 2 existe para impedir, com a
 * mesma irreversibilidade: voltar é `POST :projectId/members`, que pede
 * `maintainer`, o papel que se acabou de abandonar.
 *
 * Por isso a régua não é reescrita: o que muda entre as duas portas é só o que
 * se passa como PAPEL PEDIDO. No `add` é o papel do corpo; aqui é o papel que
 * o ator terá DEPOIS, que é o dele no workspace. A semântica bate porque
 * `ehAutoRebaixamento` compara papel-efetivo-hoje contra papel-efetivo-depois,
 * e nunca precisou saber por qual rota o segundo chegou.
 *
 * O teto 1 (`rebaixaOwnerDoWorkspace`) NÃO tem par aqui, e a ausência é
 * decisão: quem é `owner` no workspace só pode ter o efetivo ELEVADO (ou
 * mantido) pela remoção, porque `owner` é o topo do `ROLE_ORDER` — remover a
 * linha que o restringia num projeto sensível é justamente como se desfaz essa
 * restrição. Não existe remoção que rebaixe um `owner` de workspace, então um
 * teto ali recusaria só movimentos benignos.
 *
 * O ADR 0157 NÃO tocou nesta porta: ele alargou o teto 2 para a auto-PROMOÇÃO
 * nas duas rotas de associação, e a remoção continua vendo só a metade de
 * baixo, de propósito (ver o docblock de `ehAutoRebaixamento`).
 *
 * Pura como as outras: quem traduz para 403 é o caso de uso.
 */
export function remocaoEhAutoRebaixamento(movimento: {
  atorId: string;
  alvoId: string;
  papelEfetivoDoAtorNoProjeto: Role | null;
  papelDoAtorNoWorkspace: Role | null;
}): boolean {
  const {
    atorId,
    alvoId,
    papelEfetivoDoAtorNoProjeto,
    papelDoAtorNoWorkspace,
  } = movimento;

  if (atorId !== alvoId) return false;
  // Sem papel efetivo não há de onde descer — mesma cláusula do teto 2, e
  // igualmente inalcançável pelo HTTP (o `RolesGuard` já recusou).
  if (papelEfetivoDoAtorNoProjeto === null) return false;
  // Sem papel de WORKSPACE a remoção não deixa papel nenhum: é o rebaixamento
  // máximo, e é o único caso que `ehAutoRebaixamento` não sabe enunciar —
  // `papelPedidoNoProjeto` é um `Role`, e "nenhum" não é um `Role`. Alcançável:
  // basta ter a linha de projeto e nenhuma de workspace.
  if (papelDoAtorNoWorkspace === null) return true;

  return ehAutoRebaixamento({
    atorId,
    alvoId,
    papelEfetivoDoAtorNoProjeto,
    papelPedidoNoProjeto: papelDoAtorNoWorkspace,
  });
}
