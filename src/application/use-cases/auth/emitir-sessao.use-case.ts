import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccessTokenIssuer } from '../../ports/access-token-issuer.port';
import { RefreshTokenRepository } from '../../ports/refresh-token-repository.port';
import { authConfig, type ContextoDaRequisicao } from './auth-config';
import { TokenFactory } from './token-factory';

export interface SessaoEmitida {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Emite o par access+refresh.
 *
 * Extraído porque três fluxos precisam dele — login, refresh e o consumo de
 * `set_initial_password` — e porque a construção da FAMÍLIA é onde o desenho
 * pode ser sutilmente traído: um refresh que emite família nova em vez de
 * herdar a existente quebra a detecção de reuso sem quebrar nenhum teste
 * feliz.
 */
@Injectable()
export class EmitirSessaoUseCase {
  constructor(
    private readonly accessTokens: AccessTokenIssuer,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokenFactory: TokenFactory,
  ) {}

  async execute(entrada: {
    userId: string;
    email: string;
    /** Ausente = login novo, nasce família nova. */
    familyId?: string;
    /** Herdado sem alteração pela cadeia toda — é o teto absoluto. */
    familyStartedAt?: Date;
    contexto?: ContextoDaRequisicao;
  }): Promise<SessaoEmitida> {
    const acesso = await this.accessTokens.emitir({
      userId: entrada.userId,
      email: entrada.email,
    });

    const refresh = this.tokenFactory.gerar();
    await this.refreshTokens.emitir({
      userId: entrada.userId,
      familyId: entrada.familyId ?? randomUUID(),
      tokenHash: refresh.hash,
      familyStartedAt: entrada.familyStartedAt ?? new Date(),
      expiresAt: new Date(Date.now() + authConfig.refreshTtlMs()),
      ip: entrada.contexto?.ip,
      userAgent: entrada.contexto?.userAgent,
    });

    return {
      accessToken: acesso.token,
      refreshToken: refresh.bruto,
      expiresIn: acesso.expiresIn,
    };
  }
}
