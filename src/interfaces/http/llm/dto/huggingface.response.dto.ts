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
    description: '`<publisher>/<modelo>` no Hugging Face Hub.',
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
      'O publisher está no allowlist curado de fabricantes conhecidos ' +
      '(`domain/llm/huggingface-official-publishers.ts`). `false` é ' +
      'qualquer reupload de terceiro — a tela mostra o aviso de segurança ' +
      'quando `includeCommunity=true` trouxe este resultado.',
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
      'Só presente quando o Hub publicou `usedStorage` na busca — nunca ' +
      'estimado por palpite.',
  })
  estimatedSizeBytes!: number | null;

  @ApiProperty({
    enum: MODEL_PULL_STATUSES,
    example: 'pending_confirmation',
    description:
      '`pending_confirmation` → `confirmed` → `pulling` → `active` | ' +
      '`failed`. Os dois primeiros estados SÃO a segunda confirmação ' +
      'explícita que o produto exige antes de qualquer download rodar.',
  })
  status!: Wire<ModelPullRequest>['status'];

  @ApiProperty({
    example: null,
    nullable: true,
    format: 'date-time',
    description: 'Quando o clique de confirmação aconteceu.',
  })
  confirmedAt!: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description:
      'Só em `failed`, prefixado pela origem (infra | modelo | código | ' +
      'política) — nunca falha calada.',
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
