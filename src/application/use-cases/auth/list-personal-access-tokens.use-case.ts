import { Injectable } from '@nestjs/common';
import {
  PersonalAccessTokenRepository,
  type PatResumo,
} from '../../ports/personal-access-token-repository.port';

/** Lista SÓ os tokens do próprio usuário (RN-426) — escopado no WHERE do repositório. */
@Injectable()
export class ListPersonalAccessTokensUseCase {
  constructor(private readonly tokens: PersonalAccessTokenRepository) {}

  execute(userId: string, projectId: string): Promise<PatResumo[]> {
    return this.tokens.listarDoUsuarioNoProjeto(userId, projectId);
  }
}
