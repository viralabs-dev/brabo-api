import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Teto de cursores por chamada.
 *
 * Não é limite de produto — é limite de PEDIDO: cada cursor vira uma linha no
 * `VALUES` do `join`, e o corpo é escrito por quem chama. Duzentos cabe com
 * folga no maior workspace real (23 projetos) e mantém a consulta previsível
 * mesmo se alguém montar o corpo à mão.
 */
export const MAX_CURSORES = 200;

export class UnreadCursorDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({
    example: 41,
    minimum: 0,
    description:
      'Last `seq` THIS browser has already seen in this project. Returns ' +
      'events with strictly greater `seq`. `0` means "never saw anything" ' +
      'and brings the start of the most recent session.',
  })
  @IsInt()
  @Min(0)
  afterSeq!: number;
}

export class UnreadEventsDto {
  @ApiProperty({
    type: [UnreadCursorDto],
    maxItems: MAX_CURSORES,
    description:
      'One cursor per project to query. An EMPTY list returns an empty ' +
      'list — "I asked for nothing" is not "give me everything". A ' +
      "project from another workspace is silently ignored, because the " +
      "cursor comes from the caller's local storage and may carry leftovers from an old workspace.",
  })
  @IsArray()
  @ArrayMaxSize(MAX_CURSORES)
  @ValidateNested({ each: true })
  @Type(() => UnreadCursorDto)
  cursors!: UnreadCursorDto[];
}
