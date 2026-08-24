import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import {
  USER_LOCALES,
  type UserLocale,
} from '../../../../domain/iam/user.entity';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';

/**
 * Preferências do próprio usuário (fundação de i18n, Onda 6a).
 *
 * Só `locale` por ora — é a ÚNICA preferência que existe. Um objeto (não um
 * valor solto) porque é o formato que sobrevive a uma segunda preferência
 * chegando depois sem quebrar o contrato desta rota.
 */
export class UpdateUserPreferencesDto {
  @ApiProperty({
    enum: USER_LOCALES,
    example: 'en',
    description:
      'The interface language. Closed to the list — not free-form BCP-47.',
  })
  @IsIn(USER_LOCALES)
  locale!: UserLocale;
}

interface UserPreferences {
  locale: UserLocale;
}

export class UserPreferencesResponseDto implements Wire<UserPreferences> {
  @ApiProperty({ enum: USER_LOCALES, example: 'pt-BR' })
  locale!: UserLocale;
}
export const _chavesPreferencias: MesmasChaves<
  UserPreferencesResponseDto,
  UserPreferences
> = true;
