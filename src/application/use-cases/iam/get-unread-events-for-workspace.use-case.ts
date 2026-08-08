import { Injectable } from '@nestjs/common';
import {
  ProjectsSummaryRepository,
  type ProjectUnreadEvents,
  type UnreadCursor,
} from '../../ports/projects-summary-repository.port';

/**
 * O conteúdo da gaveta do sino para o workspace inteiro, numa chamada
 * (RN-091).
 *
 * Irmão de `GetProjectsSummaryForWorkspaceUseCase`, e o que faltava dele: o
 * resumo já dizia QUANTOS eventos cada projeto tem além do que o usuário viu,
 * mas QUAIS eventos são esses continuava custando uma requisição por projeto,
 * porque o corte de leitura é um `seq` que só o navegador guarda. Aqui o
 * navegador MANDA o corte de cada projeto e recebe tudo junto — mesmos dados,
 * mesma cadência, uma requisição.
 *
 * O escopo continua sendo o workspace: cursor apontando para projeto de fora
 * é descartado no `join`, não devolvido nem transformado em erro.
 */
@Injectable()
export class GetUnreadEventsForWorkspaceUseCase {
  constructor(private readonly resumo: ProjectsSummaryRepository) {}

  execute(
    workspaceId: string,
    cursors: UnreadCursor[],
  ): Promise<ProjectUnreadEvents[]> {
    return this.resumo.unreadEventsForWorkspace(workspaceId, cursors);
  }
}
