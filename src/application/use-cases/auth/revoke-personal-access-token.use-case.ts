import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PersonalAccessTokenRepository,
  type PatResumo,
} from '../../ports/personal-access-token-repository.port';

/**
 * Revoga o PRÓPRIO token (RN-426) — sem admin cross-user nesta onda, decisão
 * declarada, não lacuna esquecida.
 */
@Injectable()
export class RevokePersonalAccessTokenUseCase {
  constructor(private readonly tokens: PersonalAccessTokenRepository) {}

  async execute(id: string, userId: string): Promise<PatResumo> {
    const revogado = await this.tokens.revogar(id, userId, 'user_requested');
    if (!revogado) throw new NotFoundException('Token não encontrado');
    return revogado;
  }
}
