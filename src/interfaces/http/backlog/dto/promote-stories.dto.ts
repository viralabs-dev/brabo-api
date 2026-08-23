import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsNotEmpty, IsString } from 'class-validator';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import type {
  PromocaoRecusada,
  PromoteStoriesResult,
} from '../../../../application/use-cases/backlog/promote-stories.use-case';

/**
 * Promoção de histórias pelo usuário (Fase 12c — RN-048).
 *
 * A rota é sempre de LOTE, mesmo para uma história só: um único caminho para
 * exercitar, e o comportamento de falha parcial fica provado também no caso
 * de um item.
 */
export class PromoteStoriesDto {
  @ApiProperty({
    type: [String],
    example: ['01JC2XK9Q7', '01JC2XKB4M'],
    description:
      'Ids of the stories to promote to `ready`. A single one is a batch of 1. ' +
      'Each story is validated and promoted on its own — one that fails does ' +
      'not block the others.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  storyIds!: string[];
}

/** Uma história que o lote não conseguiu promover, e por quê. */
export class PromocaoRecusadaResponseDto implements Wire<PromocaoRecusada> {
  @ApiProperty({ example: '01JC2XK9Q7' })
  storyId!: string;

  @ApiProperty({
    example: 'Story is not ready: missing dod, dor',
    description:
      'Readable reason. The story may have lost its readiness, or one of its ' +
      'modules may have dropped out of `module_map` between the proposal and the decision.',
  })
  reason!: string;
}
export const _chavesPromocaoRecusada: MesmasChaves<
  PromocaoRecusadaResponseDto,
  PromocaoRecusada
> = true;

/**
 * O resultado do lote. **Não é all-or-nothing**: a resposta é 201 mesmo com
 * itens em `failed` — o usuário revisou aquelas histórias e a decisão dele
 * sobre as que passaram não pode ser desfeita por uma que não passou.
 */
export class PromoteStoriesResponseDto implements Wire<PromoteStoriesResult> {
  @ApiProperty({
    type: [String],
    description: 'Ids that went to `ready`, with their tasks already pickable.',
  })
  promoted!: string[];

  @ApiProperty({
    type: [PromocaoRecusadaResponseDto],
    description: 'Empty when the whole batch passed.',
  })
  failed!: PromocaoRecusadaResponseDto[];
}
export const _chavesPromoteStories: MesmasChaves<
  PromoteStoriesResponseDto,
  PromoteStoriesResult
> = true;

/** Recusa da promoção, com o comentário que volta ao PO. */
export class ReturnStoryDto {
  @ApiProperty({
    example: "The acceptance criteria don't cover the payment refusal case.",
    description:
      'The reason is REQUIRED: it becomes a message pinned to the PO session, ' +
      'and a return with no reason hands back work with no information.',
  })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
