import { Injectable } from '@nestjs/common';
import { ModelPullRequestRepository } from '../../../ports/model-pull-request-repository.port';
import type { ModelPullRequest } from '../../../../domain/huggingface/model-pull-request.entity';

export interface RequestModelPullInput {
  workspaceId: string;
  requestedBy: string;
  repoId: string;
  estimatedSizeBytes?: number | null;
}

/**
 * Primeira etapa do pull: cria o pedido em `pending_confirmation` — NADA
 * roda ainda. O produto exige uma segunda confirmação explícita antes de
 * qualquer download de verdade (nunca pull automático e silencioso); esta
 * chamada só registra a INTENÇÃO, e é `ConfirmModelPullUseCase` — um clique
 * separado — quem de fato dispara o pull no Ollama.
 *
 * Papel exigido na rota: owner/maintainer (mesmo padrão de mutação do
 * catálogo de LLM).
 */
@Injectable()
export class RequestModelPullUseCase {
  constructor(private readonly pullRequests: ModelPullRequestRepository) {}

  async execute(input: RequestModelPullInput): Promise<ModelPullRequest> {
    return this.pullRequests.create({
      workspaceId: input.workspaceId,
      requestedBy: input.requestedBy,
      repoId: input.repoId,
      estimatedSizeBytes: input.estimatedSizeBytes ?? null,
    });
  }
}
