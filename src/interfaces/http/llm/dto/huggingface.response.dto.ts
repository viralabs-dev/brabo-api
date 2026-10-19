import { ApiProperty } from '@nestjs/swagger';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import type { HuggingFaceModel } from '../../../../infrastructure/huggingface/huggingface-client';
import {
  MODEL_PULL_STATUSES,
  type ModelPullRequest,
} from '../../../../domain/huggingface/model-pull-request.entity';

export class HuggingFaceModelResponseDto implements Wire<HuggingFaceModel> {
  @ApiProperty({
    example: 'meta-llama/Llama-3.1-8B-Instruct-GGUF',
    description: '`<publisher>/<model>` on the Hugging Face Hub.',
  })
  repoId!: string;

  @ApiProperty({ example: 'meta-llama' })
  publisher!: string;

  @ApiProperty({ example: 182034 })
  downloads!: number;

  @ApiProperty({ example: 210 })
  likes!: number;

  @ApiProperty({
    example: true,
    description:
      'The publisher is in the curated allowlist of known vendors ' +
      '(`domain/llm/huggingface-official-publishers.ts`). `false` is ' +
      'any third-party reupload — the screen shows the security warning ' +
      'when `includeCommunity=true` brought this result.',
  })
  official!: boolean;
}
export const _chavesHuggingFaceModel: MesmasChaves<
  HuggingFaceModelResponseDto,
  HuggingFaceModel
> = true;

export class ModelPullRequestResponseDto implements Wire<ModelPullRequest> {
  @ApiProperty({ example: '9b1c2d3e-4f50-4a61-8b72-0c3d4e5f6a7b' })
  id!: string;

  @ApiProperty({ example: '9b1c2d3e-4f50-4a61-8b72-0c3d4e5f6a7b' })
  workspaceId!: string;

  @ApiProperty({ example: '9b1c2d3e-4f50-4a61-8b72-0c3d4e5f6a7b' })
  requestedBy!: string;

  @ApiProperty({ example: 'meta-llama/Llama-3.1-8B-Instruct-GGUF' })
  repoId!: string;

  @ApiProperty({
    example: null,
    nullable: true,
    description:
      'Present only when the Hub published `usedStorage` in the search — ' +
      'never guessed.',
  })
  estimatedSizeBytes!: number | null;

  @ApiProperty({
    enum: MODEL_PULL_STATUSES,
    example: 'pending_confirmation',
    description:
      '`pending_confirmation` → `confirmed` → `pulling` → `active` | ' +
      '`failed`. The first two states ARE the second explicit confirmation ' +
      'the product requires before any download runs.',
  })
  status!: Wire<ModelPullRequest>['status'];

  @ApiProperty({
    example: null,
    nullable: true,
    format: 'date-time',
    description: 'When the confirmation click happened.',
  })
  confirmedAt!: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description:
      'Only in `failed`, prefixed by the origin (infra | model | code | ' +
      'policy) — never a silent failure.',
  })
  failedReason!: string | null;

  @ApiProperty({ example: '2026-08-26T12:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-08-26T12:00:00.000Z', format: 'date-time' })
  updatedAt!: string;
}
export const _chavesModelPullRequest: MesmasChaves<
  ModelPullRequestResponseDto,
  ModelPullRequest
> = true;
