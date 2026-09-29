import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsString, MaxLength, ValidateIf } from 'class-validator';
import {
  USER_LOCALES,
  type UserLocale,
} from '../../../../domain/iam/user.entity';
import {
  IDIOMA_AUTOMATICO,
  TAMANHO_MAXIMO_DO_IDIOMA,
  type OrigemDoIdiomaDaResposta,
} from '../../../../domain/iam/idioma-de-resposta';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import { ORIGENS_DO_IDIOMA_DA_RESPOSTA } from './user-preferences.dto';

/**
 * Corpo de `PUT .../sessions/:sessionId/response-language` (RN-618).
 *
 * `null` é obrigatório e explícito, pelo motivo de `SetMirrorPathDto`: soltar
 * o override é um ato deliberado, e um corpo incompleto não pode apagá-lo em
 * silêncio. `@IsOptional()` trataria `null` e `undefined` como a mesma coisa.
 */
export class SetSessionResponseLanguageDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'en',
    maxLength: TAMANHO_MAXIMO_DO_IDIOMA,
    description:
      'The language agents answer YOU in, in THIS session only (RN-618) — ' +
      'other participants are never affected. Any BCP-47 code the server ' +
      'recognizes, stored canonical. Send `null` (or ' +
      `\`${IDIOMA_AUTOMATICO}\`) — the key is REQUIRED — to go back to ` +
      'inheriting from your Account.',
  })
  @IsDefined()
  @ValidateIf((o: SetSessionResponseLanguageDto) => o.language !== null)
  @IsString()
  @MaxLength(TAMANHO_MAXIMO_DO_IDIOMA)
  language!: string | null;
}

interface IdiomaDaRespostaNaSessao {
  language: string;
  origin: OrigemDoIdiomaDaResposta;
  sessionOverride: string | null;
  account: string;
  detected: string | null;
  interfaceLocale: UserLocale;
  detectionQuestion: string | null;
}

/**
 * O idioma efetivo de QUEM CHAMA nesta sessão, com a cadeia inteira — a tela
 * mostra o vencedor, a origem e o que ficou por baixo (RN-620).
 */
export class SessionResponseLanguageResponseDto implements Wire<IdiomaDaRespostaNaSessao> {
  @ApiProperty({ example: 'pt-BR', description: 'The effective language.' })
  language!: string;

  @ApiProperty({
    enum: ORIGENS_DO_IDIOMA_DA_RESPOSTA,
    example: 'interface',
    description:
      'Where `language` came from: `sessao` (fixed in this session) > ' +
      '`conta` (Account choice) > `detectado` (detected AND confirmed) > ' +
      '`interface` (the interface language).',
  })
  origin!: OrigemDoIdiomaDaResposta;

  @ApiProperty({ type: String, nullable: true, example: null })
  sessionOverride!: string | null;

  @ApiProperty({
    example: IDIOMA_AUTOMATICO,
    description: `\`${IDIOMA_AUTOMATICO}\` or the code chosen on the Account.`,
  })
  account!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  detected!: string | null;

  @ApiProperty({ enum: USER_LOCALES, example: 'pt-BR' })
  interfaceLocale!: UserLocale;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'es',
    description:
      'The language YOUR recent messages point to, when the screen should ' +
      'ASK whether to use it for the answers (RN-624) — `null` means no ' +
      'question. Detection never changes the preference by itself: only ' +
      'answering `confirm` on `POST /users/me/preferences/detected-language` ' +
      'does. Never asked when the effective language comes from an explicit ' +
      'choice (this session or the Account), when it already is the detected ' +
      'one, or when you declined this language before. Best effort: a ' +
      'detection failure is `null`, never an error of this route.',
  })
  detectionQuestion!: string | null;
}
export const _chavesIdiomaNaSessao: MesmasChaves<
  SessionResponseLanguageResponseDto,
  IdiomaDaRespostaNaSessao
> = true;
