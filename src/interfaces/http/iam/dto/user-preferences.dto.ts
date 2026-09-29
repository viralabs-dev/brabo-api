import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
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

export const ORIGENS_DO_IDIOMA_DA_RESPOSTA: readonly OrigemDoIdiomaDaResposta[] =
  ['sessao', 'conta', 'detectado', 'interface'];

/**
 * Preferências do próprio usuário (fundação de i18n, Onda 6a; RN-618).
 *
 * Um objeto (não um valor solto) porque é o formato que sobreviveu a uma
 * segunda preferência chegando depois sem quebrar o contrato desta rota — e
 * foi o que aconteceu: `responseLanguage` entrou ao lado de `locale`. Os dois
 * são OPCIONAIS e independentes; mandar só um não toca o outro.
 */
export class UpdateUserPreferencesDto {
  @ApiProperty({
    enum: USER_LOCALES,
    required: false,
    example: 'en',
    description:
      'The interface language. Closed to the list — not free-form BCP-47.',
  })
  @IsOptional()
  @IsIn(USER_LOCALES)
  locale?: UserLocale;

  @ApiProperty({
    required: false,
    example: 'es',
    maxLength: TAMANHO_MAXIMO_DO_IDIOMA,
    description:
      `The language agents answer in (RN-618): \`${IDIOMA_AUTOMATICO}\` or ` +
      'ANY BCP-47 code whose language the server recognizes — an open list, ' +
      'unlike `locale`. Stored canonical (`pt-br` becomes `pt-BR`). An ' +
      'unrecognized code is a 400 that names the rule. Never changes `locale`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(TAMANHO_MAXIMO_DO_IDIOMA)
  responseLanguage?: string;
}

export class IdiomaEfetivoResponseDto {
  @ApiProperty({ example: 'pt-BR' })
  language!: string;

  @ApiProperty({ enum: ORIGENS_DO_IDIOMA_DA_RESPOSTA, example: 'interface' })
  origin!: OrigemDoIdiomaDaResposta;
}

interface UserPreferences {
  locale: UserLocale;
  responseLanguage: string;
  detectedLanguage: string | null;
  detectedLanguageConfirmedAt: Date | null;
  effectiveResponseLanguage: {
    language: string;
    origin: OrigemDoIdiomaDaResposta;
  };
}

export class UserPreferencesResponseDto implements Wire<UserPreferences> {
  @ApiProperty({ enum: USER_LOCALES, example: 'pt-BR' })
  locale!: UserLocale;

  @ApiProperty({
    example: IDIOMA_AUTOMATICO,
    description:
      `\`${IDIOMA_AUTOMATICO}\` (every account starts there) or the BCP-47 ` +
      'code explicitly chosen on the Account page.',
  })
  responseLanguage!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description:
      'The language detected from your own messages AND confirmed by you — ' +
      'never an unconfirmed detection. `null` until a confirmation exists.',
  })
  detectedLanguage!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  detectedLanguageConfirmedAt!: string | null;

  @ApiProperty({
    type: IdiomaEfetivoResponseDto,
    description:
      'What applies today OUTSIDE any session, and where it came from: ' +
      'account choice > confirmed detection > interface language.',
  })
  effectiveResponseLanguage!: IdiomaEfetivoResponseDto;
}
export const _chavesPreferencias: MesmasChaves<
  UserPreferencesResponseDto,
  UserPreferences
> = true;
