import { ForbiddenException, Injectable } from '@nestjs/common';
import { WorkspaceRepository } from '../../ports/workspace-repository.port';
import {
  MENSAGEM_TETO_AUTO_PROMOCAO_NO_WORKSPACE,
  MENSAGEM_TETO_AUTO_REBAIXAMENTO_NO_WORKSPACE,
  autoMovimentoDoProprioPapel,
} from '../../../domain/iam/tetos-de-rebaixamento';
import type { Role } from '../../../domain/iam/role';

/**
 * Associa (ou re-associa, é upsert) alguém ao workspace, aplicando o teto de
 * auto-movimento antes de escrever (ADR 0157, RN-557).
 *
 * Era um passthrough de uma linha, e a rota é `@RequireRole('owner')`: o
 * chamador é sempre o topo do `ROLE_ORDER` e não havia NADA olhando para o alvo
 * nem para a relação ator↔alvo. Um `owner` se gravava `viewer` e perdia o
 * workspace inteiro — e aqui, diferente do projeto, não existe nível acima para
 * segurar a queda nem rota que remova membro: `WorkspacesController` não tem
 * `@Delete` de membro, e desfazer é esta mesma rota, que pede o `owner` recém
 * abandonado. Sem caminho de volta pela tela.
 *
 * **O teto 1 não tem par aqui, e a ausência é decisão** (ADR 0157). Ele é uma
 * regra sobre INVERSÃO DE HIERARQUIA — no projeto, a linha sobrepõe a de
 * workspace, então um `maintainer` alcança quem está ACIMA dele. Neste escopo a
 * inversão não existe: `@RequireRole('owner')` já garante que ninguém alcança
 * alguém de papel maior que o seu. Recusar um `owner` que rebaixa OUTRO `owner`
 * faria de `owner` um estado absorvente — sem rota de remoção, ninguém sairia
 * dele por HTTP nunca —, que é a classe de estado que o ADR 0127 nasceu para
 * eliminar.
 *
 * **O teto não conta owners**, e a contagem foi recusada explicitamente: a
 * cláusula "a si mesmo" não tem número para envelhecer. E ela já produz o
 * invariante que a contagem existiria para garantir — um workspace nunca fica
 * sem `owner`, porque tirar o último exigiria que ele mesmo o fizesse.
 *
 * O papel do ator vem de `WorkspaceRepository.findMemberRole`, e não do
 * `ResolveEffectiveRoleUseCase` como nos dois casos de uso de projeto: lá o
 * caso de uso injeta o outro para o papel do ator não virar uma segunda
 * composição de `projectRole ?? workspaceRole` escrita à mão. Aqui não há
 * composição a proteger — `forWorkspace` É `findMemberRole` —, e este caso de
 * uso já tem o repositório na mão. É a mesma economia que o ADR 0156 fez no
 * sentido inverso: nenhuma dependência a mais por uma leitura.
 */
@Injectable()
export class AddWorkspaceMemberUseCase {
  constructor(private readonly workspaces: WorkspaceRepository) {}

  async execute(
    workspaceId: string,
    atorId: string,
    alvoId: string,
    papel: Role,
  ) {
    const papelDoAtor = await this.workspaces.findMemberRole(
      workspaceId,
      atorId,
    );

    const movimento = autoMovimentoDoProprioPapel({
      atorId,
      alvoId,
      papelEfetivoDoAtor: papelDoAtor,
      papelPedido: papel,
    });
    if (movimento === 'rebaixamento') {
      throw new ForbiddenException(
        MENSAGEM_TETO_AUTO_REBAIXAMENTO_NO_WORKSPACE,
      );
    }
    // Inalcançável pela rota (o `RolesGuard` só deixa passar quem já é `owner`,
    // o topo, e não há para onde subir), e aplicada mesmo assim: o caso de uso
    // não presume o guard, e é ele que fica certo no dia em que a rota mudar de
    // mínimo — que é a razão pela qual o teto 2 nunca teve limiar.
    if (movimento === 'promocao') {
      throw new ForbiddenException(MENSAGEM_TETO_AUTO_PROMOCAO_NO_WORKSPACE);
    }

    return this.workspaces.addMember(workspaceId, alvoId, papel);
  }
}
