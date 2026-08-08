import { Injectable } from '@nestjs/common';
import {
  ProjectsSummaryRepository,
  type ProjectCardSummary,
} from '../../ports/projects-summary-repository.port';

/**
 * Uma linha por projeto do workspace com TUDO que o card do dashboard
 * desenha (RN-090).
 *
 * Irmão de `GetProjectsStatusForWorkspaceUseCase`, e pelo mesmo motivo: a
 * grade de cards é uma leitura do WORKSPACE, não N leituras de projeto. A
 * diferença é de tamanho — aquele resolvia um dot, este resolve o card
 * inteiro, e é o que tira o dashboard de 3.824 requisições por minuto (23
 * projetos × 7 consultas em poll) para 12.
 */
@Injectable()
export class GetProjectsSummaryForWorkspaceUseCase {
  constructor(private readonly resumo: ProjectsSummaryRepository) {}

  execute(workspaceId: string): Promise<ProjectCardSummary[]> {
    return this.resumo.summarizeForWorkspace(workspaceId);
  }
}
