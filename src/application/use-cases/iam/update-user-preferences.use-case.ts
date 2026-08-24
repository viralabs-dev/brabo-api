import { Injectable } from '@nestjs/common';
import { UserRepository } from '../../ports/user-repository.port';
import type { UserLocale } from '../../../domain/iam/user.entity';

/**
 * Grava a preferência de idioma do próprio usuário (fundação de i18n, Onda
 * 6a). Só `locale` hoje — ver `UserRepository.updateLocale` sobre por que o
 * repositório não ganhou um `update` genérico.
 */
@Injectable()
export class UpdateUserPreferencesUseCase {
  constructor(private readonly usuarios: UserRepository) {}

  async execute(
    userId: string,
    locale: UserLocale,
  ): Promise<{ locale: UserLocale }> {
    const usuario = await this.usuarios.updateLocale(userId, locale);
    return { locale: usuario.locale };
  }
}
