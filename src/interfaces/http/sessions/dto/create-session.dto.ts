import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  SESSION_KINDS,
  type SessionKind,
} from '../../../../domain/sessions/session-kind';
import { LIMITE_NOME_DA_SESSAO } from './rename-session.dto';

/**
 * O corpo de `POST /projects/:projectId/sessions` (FASE 20).
 *
 * A rota não tinha corpo nenhum até aqui, e é essa a mudança de produto: o
 * tipo da sessão é decidido por quem a abre, não deduzido depois de um botão
 * na barra de topo.
 */
export class CreateSessionDto {
  @ApiProperty({
    enum: SESSION_KINDS,
    example: 'criativa',
    description:
      'A intenção da sessão. `consultiva` é só conversa; `criativa` é a que ' +
      'produz — abre a ideação com o Criativo e é a única que entra em ' +
      'execução. OBRIGATÓRIO: sem ele a resposta é 400, porque o tipo é ' +
      'escolha de quem abre e fica gravado.',
  })
  @IsIn(SESSION_KINDS)
  kind!: SessionKind;

  @ApiPropertyOptional({
    example: 'Checkout do carrinho',
    maxLength: LIMITE_NOME_DA_SESSAO,
    description:
      'Nome amigável, opcional. Não substitui a hashtag do id — as telas ' +
      'compõem os dois. Em branco conta como ausente.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITE_NOME_DA_SESSAO)
  name?: string;
}
