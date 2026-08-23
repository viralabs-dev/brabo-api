import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PersonalAccessTokenRepository,
  type PatResumo,
} from '../../ports/personal-access-token-repository.port';

/**
 * Revoga o token de QUALQUER usuário no projeto (RN-427) — resposta a
 * incidente (dev desligado com token vazando). Escopado ao PROJETO, nunca
 * ao usuário chamador; a autorização de quem pode chamar isto é
 * `@RequireRole('maintainer')` na rota, não este caso de uso.
 */
@Injectable()
export class RevokePersonalAccessTokenAsMaintainerUseCase {
  constructor(private readonly tokens: PersonalAccessTokenRepository) {}

  async execute(id: string, projectId: string): Promise<PatResumo> {
    const revogado = await this.tokens.revogarComoMaintainer(
      id,
      projectId,
      'revoked_by_maintainer',
    );
    if (!revogado) throw new NotFoundException('Token não encontrado');
    return revogado;
  }
}
