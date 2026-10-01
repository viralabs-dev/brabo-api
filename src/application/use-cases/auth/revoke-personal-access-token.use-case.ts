import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import {
  PersonalAccessTokenRepository,
  type PatResumo,
} from '../../ports/personal-access-token-repository.port';
import { derrubarConexoesDoPat } from './derrubar-conexoes-do-pat';

/**
 * Revoga o PRÓPRIO token (RN-426) — sem admin cross-user nesta onda, decisão
 * declarada, não lacuna esquecida. Desde o ADR 0201 (RN-685) a revogação
 * também derruba as conexões de runner abertas com ESTE token, e só elas
 * (`derrubarConexoesDoPat`), depois de gravar.
 */
@Injectable()
export class RevokePersonalAccessTokenUseCase {
  private readonly logger = new Logger(RevokePersonalAccessTokenUseCase.name);

  constructor(
    private readonly tokens: PersonalAccessTokenRepository,
    private readonly engine: ApiToEngineClient,
  ) {}

  async execute(id: string, userId: string): Promise<PatResumo> {
    const revogado = await this.tokens.revogar(id, userId, 'user_requested');
    if (!revogado) throw new NotFoundException('Token não encontrado');
    await derrubarConexoesDoPat(this.engine, this.logger, revogado.id);
    return revogado;
  }
}
