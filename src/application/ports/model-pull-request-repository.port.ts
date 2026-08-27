import type { ModelPullRequest } from '../../domain/huggingface/model-pull-request.entity';

export interface NewModelPullRequest {
  workspaceId: string;
  requestedBy: string;
  repoId: string;
  estimatedSizeBytes?: number | null;
}

export abstract class ModelPullRequestRepository {
  abstract create(input: NewModelPullRequest): Promise<ModelPullRequest>;
  abstract findById(id: string): Promise<ModelPullRequest | null>;
  /** Escopado ao workspace — um pedido de um workspace não vaza para outro. */
  abstract findByIdInWorkspace(
    id: string,
    workspaceId: string,
  ): Promise<ModelPullRequest | null>;
  abstract markConfirmed(id: string): Promise<ModelPullRequest>;
  abstract markPulling(id: string): Promise<ModelPullRequest>;
  abstract markActive(id: string): Promise<ModelPullRequest>;
  /** `reason` sempre prefixado pela origem — nunca falha calada (ADR 0020). */
  abstract markFailed(id: string, reason: string): Promise<ModelPullRequest>;
}
