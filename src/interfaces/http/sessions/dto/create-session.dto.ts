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
      "The session's intent. `consultiva` (consultative) is conversation " +
      'only; `criativa` (creative) is the one that produces — it opens ' +
      'ideation with the Creative agent and is the only one that enters ' +
      'execution. REQUIRED: without it the response is 400, because the ' +
      "type is the opener's choice and gets recorded.",
  })
  @IsIn(SESSION_KINDS)
  kind!: SessionKind;

  @ApiPropertyOptional({
    example: 'Cart checkout',
    maxLength: LIMITE_NOME_DA_SESSAO,
    description:
      "Friendly name, optional. Does not replace the id's hashtag — screens " +
      'compose the two. Blank counts as absent.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITE_NOME_DA_SESSAO)
  name?: string;
}
