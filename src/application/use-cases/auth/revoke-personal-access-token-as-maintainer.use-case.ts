import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import {
  PersonalAccessTokenRepository,
  type PatResumo,
} from '../../ports/personal-access-token-repository.port';
import { derrubarConexoesDoPat } from './derrubar-conexoes-do-pat';

/**
 * Revoga o token de QUALQUER usuário no projeto (RN-427) — resposta a
 * incidente (dev desligado com token vazando). Escopado ao PROJETO, nunca
 * ao usuário chamador; a autorização de quem pode chamar isto é
 * `@RequireRole('maintainer')` na rota, não este caso de uso.
 *
 * Desde o ADR 0201 (RN-685) a revogação também derruba as conexões de runner
 * abertas com ESTE token — é o que faz dela resposta a incidente de verdade:
 * sem isso, o runner já conectado com o token vazado seguia de pé.
 */
@Injectable()
export class RevokePersonalAccessTokenAsMaintainerUseCase {
  private readonly logger = new Logger(
    RevokePersonalAccessTokenAsMaintainerUseCase.name,
  );

  constructor(
    private readonly tokens: PersonalAccessTokenRepository,
    private readonly engine: ApiToEngineClient,
  ) {}

  async execute(id: string, projectId: string): Promise<PatResumo> {
    const revogado = await this.tokens.revogarComoMaintainer(
      id,
      projectId,
      'revoked_by_maintainer',
    );
    if (!revogado) throw new NotFoundException('Token não encontrado');
    await derrubarConexoesDoPat(this.engine, this.logger, revogado.id);
    return revogado;
  }
}
