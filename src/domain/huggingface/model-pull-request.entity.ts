/**
 * `pending_confirmation` → `confirmed` → `pulling` → `active` | `failed`.
 *
 * Os dois primeiros estados SÃO a segunda confirmação explícita que o produto
 * exige antes de qualquer download: `RequestModelPullUseCase` só cria a linha
 * em `pending_confirmation` (nada roda ainda); `ConfirmModelPullUseCase` é o
 * clique separado que move para `confirmed` e É QUEM dispara o pull de
 * verdade em seguida. Nunca existe um caminho que pula direto para `pulling`.
 */
export const MODEL_PULL_STATUSES = [
  'pending_confirmation',
  'confirmed',
  'pulling',
  'active',
  'failed',
] as const;
export type ModelPullStatus = (typeof MODEL_PULL_STATUSES)[number];

export interface ModelPullRequest {
  id: string;
  workspaceId: string;
  requestedBy: string;
  repoId: string;
  estimatedSizeBytes: number | null;
  status: ModelPullStatus;
  confirmedAt: Date | null;
  /** Só populado em `failed`; sempre prefixado pela origem (RN do ADR 0020). */
  failedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}
