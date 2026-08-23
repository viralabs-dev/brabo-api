import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRepository } from '../../ports/user-repository.port';
import type { UserLocale } from '../../../domain/iam/user.entity';

/**
 * Lê a preferência de idioma do próprio usuário (fundação de i18n, Onda 6a).
 *
 * Existe além do que já vem no payload de login/refresh
 * (`EmitirSessaoUseCase`) para o caso em que a `AccountPage` precisa
 * reafirmar o valor sem esperar o próximo refresh — ex.: aba aberta há muito
 * tempo, ou depois de um `PATCH` feito em outra aba.
 */
@Injectable()
export class GetUserPreferencesUseCase {
  constructor(private readonly usuarios: UserRepository) {}

  async execute(userId: string): Promise<{ locale: UserLocale }> {
    const usuario = await this.usuarios.findById(userId);
    if (!usuario) throw new NotFoundException('Usuário não encontrado');
    return { locale: usuario.locale };
  }
}
