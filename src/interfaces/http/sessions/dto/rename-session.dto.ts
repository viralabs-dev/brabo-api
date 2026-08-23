import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, ValidateIf } from 'class-validator';

/**
 * Teto do nome da sessão.
 *
 * Existe porque o rótulo é composto com a hashtag numa barra de largura fixa —
 * sem limite, um nome colado de qualquer lugar empurra a hashtag para fora da
 * tela, que é justamente o que a RN-098 impede.
 */
export const LIMITE_NOME_DA_SESSAO = 80;

/** Corpo de `PATCH /projects/:projectId/sessions/:sessionId` (RN-098). */
export class RenameSessionDto {
  @ApiProperty({
    example: 'Cart checkout',
    nullable: true,
    maxLength: LIMITE_NOME_DA_SESSAO,
    description:
      'The new name. `null` (or a blank string) CLEARS the name and the ' +
      'session goes back to identifying itself only by the hashtag — this ' +
      'is the undo path, which is why the field accepts null instead of ' +
      'requiring a removal route.',
  })
  // `ValidateIf` em vez de `IsOptional`: `IsOptional` também deixaria passar
  // `undefined`, e aqui a AUSÊNCIA do campo não é pedido válido — não há o que
  // renomear. `null` é, e é o que apaga o nome.
  @ValidateIf((_, valor) => valor !== null)
  @IsString()
  @MaxLength(LIMITE_NOME_DA_SESSAO)
  name!: string | null;
}
