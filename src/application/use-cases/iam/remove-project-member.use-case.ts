import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import { ResolveEffectiveRoleUseCase } from './resolve-effective-role.use-case';
import {
  MENSAGEM_TETO_AUTO_REBAIXAMENTO_POR_REMOCAO,
  remocaoEhAutoRebaixamento,
} from '../../../domain/iam/tetos-de-rebaixamento';

/**
 * Desassocia alguém do projeto, aplicando o teto de auto-rebaixamento sobre o
 * efeito LÍQUIDO da remoção (ADR 0156, RN-556).
 *
 * O ADR 0127 pôs os dois tetos só no `add` e declarou esta porta aberta: a
 * remoção derruba o papel efetivo de `projectRole` para `workspaceRole`
 * (RN-471), o que é benigno quando o workspace segura a queda e é
 * auto-rebaixamento irreversível quando não segura — voltar é
 * `POST :projectId/members`, que pede o `maintainer` recém-abandonado. A regra
 * é a MESMA do teto 2; o que muda é só o papel comparado, e ela mora inteira
 * em `domain/iam/tetos-de-rebaixamento.ts`, sem cópia aqui.
 *
 * `ResolveEffectiveRoleUseCase` entra pela razão que o `add` já registrou: o
 * papel do ator não pode virar uma segunda composição de
 * `projectRole ?? workspaceRole` escrita à mão. Ele também dá o papel de
 * workspace (`forWorkspace`), o que evita uma dependência de
 * `WorkspaceRepository` só para uma leitura.
 *
 * As duas leituras acontecem mesmo quando o alvo é OUTRA pessoa, e é de
 * propósito: quem decide se o movimento é auto-rebaixamento é a função pura,
 * não um `if` aqui que teria de repetir `atorId === alvoId` — o mesmo custo de
 * duas consultas que o ADR 0127 aceitou no `add`, numa rota de administração.
 */
@Injectable()
export class RemoveProjectMemberUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly resolveEffectiveRole: ResolveEffectiveRoleUseCase,
  ) {}

  async execute(projectId: string, atorId: string, alvoId: string) {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');

    const papelEfetivoDoAtorNoProjeto =
      await this.resolveEffectiveRole.forProject(atorId, projectId);
    const papelDoAtorNoWorkspace = await this.resolveEffectiveRole.forWorkspace(
      atorId,
      project.workspaceId,
    );

    if (
      remocaoEhAutoRebaixamento({
        atorId,
        alvoId,
        papelEfetivoDoAtorNoProjeto,
        papelDoAtorNoWorkspace,
      })
    ) {
      throw new ForbiddenException(MENSAGEM_TETO_AUTO_REBAIXAMENTO_POR_REMOCAO);
    }

    await this.projects.removeMember(projectId, alvoId);
  }
}
