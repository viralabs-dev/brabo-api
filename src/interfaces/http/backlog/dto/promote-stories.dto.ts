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
      'Ids das histórias a promover para `ready`. Uma só é um lote de 1. ' +
      'Cada história é validada e promovida por conta própria — uma que ' +
      'falhe não impede as outras.',
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
    example: 'História não está pronta: faltam dod, dor',
    description:
      'Motivo legível. A história pode ter perdido a prontidão, ou um módulo ' +
      'dela pode ter saído do `module_map` entre a proposta e a decisão.',
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
    description: 'Ids que foram para `ready`, com as tasks já pegáveis.',
  })
  promoted!: string[];

  @ApiProperty({
    type: [PromocaoRecusadaResponseDto],
    description: 'Vazio quando o lote inteiro passou.',
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
    example: 'Os critérios de aceite não cobrem o caso de recusa do pagamento.',
    description:
      'O motivo é OBRIGATÓRIO: ele vira mensagem fixada na sessão do PO, e ' +
      'uma devolução sem motivo devolve trabalho sem informação.',
  })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
