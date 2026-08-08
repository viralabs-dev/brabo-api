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
      'Último `seq` que ESTE navegador já viu neste projeto. Devolve os eventos ' +
      'com `seq` estritamente maior. `0` significa "nunca vi nada" e traz o começo ' +
      'da sessão mais recente.',
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
      'Um cursor por projeto que se quer consultar. Lista VAZIA devolve lista ' +
      'vazia — "não perguntei nada" não é "me dê tudo". Projeto de outro ' +
      'workspace é ignorado em silêncio, porque o cursor vem do armazenamento ' +
      'local de quem chama e pode ter sobra de um workspace antigo.',
  })
  @IsArray()
  @ArrayMaxSize(MAX_CURSORES)
  @ValidateNested({ each: true })
  @Type(() => UnreadCursorDto)
  cursors!: UnreadCursorDto[];
}
