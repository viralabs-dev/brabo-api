import { Injectable } from '@nestjs/common';
import {
  PersonalAccessTokenRepository,
  type PatResumoComDono,
} from '../../ports/personal-access-token-repository.port';

/** Lista TODOS os tokens do projeto, de qualquer usuário (RN-427). */
@Injectable()
export class ListPersonalAccessTokensAsMaintainerUseCase {
  constructor(private readonly tokens: PersonalAccessTokenRepository) {}

  execute(projectId: string): Promise<PatResumoComDono[]> {
    return this.tokens.listarDoProjeto(projectId);
  }
}
