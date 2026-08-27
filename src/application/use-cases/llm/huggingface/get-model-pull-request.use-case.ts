import { Injectable, NotFoundException } from '@nestjs/common';
import { ModelPullRequestRepository } from '../../../ports/model-pull-request-repository.port';
import type { ModelPullRequest } from '../../../../domain/huggingface/model-pull-request.entity';

/**
 * Status para o frontend fazer polling — `ConfirmModelPullUseCase` roda
 * síncrono (ver o comentário lá sobre a ausência de fila própria na api),
 * então esta rota é para quem prefere não segurar a conexão HTTP do
 * `confirm` aberta pela duração inteira do download.
 */
@Injectable()
export class GetModelPullRequestUseCase {
  constructor(private readonly pullRequests: ModelPullRequestRepository) {}

  async execute(id: string, workspaceId: string): Promise<ModelPullRequest> {
    const pedido = await this.pullRequests.findByIdInWorkspace(id, workspaceId);
    if (!pedido) {
      throw new NotFoundException('Pedido de pull não encontrado');
    }
    return pedido;
  }
}
