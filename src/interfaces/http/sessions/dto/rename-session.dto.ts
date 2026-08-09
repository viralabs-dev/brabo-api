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
    example: 'Checkout do carrinho',
    nullable: true,
    maxLength: LIMITE_NOME_DA_SESSAO,
    description:
      'O nome novo. `null` (ou string em branco) TIRA o nome e a sessão volta ' +
      'a se identificar só pela hashtag — é o caminho de desfazer, e por isso ' +
      'o campo aceita nulo em vez de exigir uma rota de remoção.',
  })
  // `ValidateIf` em vez de `IsOptional`: `IsOptional` também deixaria passar
  // `undefined`, e aqui a AUSÊNCIA do campo não é pedido válido — não há o que
  // renomear. `null` é, e é o que apaga o nome.
  @ValidateIf((_, valor) => valor !== null)
  @IsString()
  @MaxLength(LIMITE_NOME_DA_SESSAO)
  name!: string | null;
}
