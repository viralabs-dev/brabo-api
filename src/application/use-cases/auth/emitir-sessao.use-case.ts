import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccessTokenIssuer } from '../../ports/access-token-issuer.port';
import { RefreshTokenRepository } from '../../ports/refresh-token-repository.port';
import { UserRepository } from '../../ports/user-repository.port';
import type { UserLocale } from '../../../domain/iam/user.entity';
import { authConfig, type ContextoDaRequisicao } from './auth-config';
import { TokenFactory } from './token-factory';

export interface SessaoEmitida {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  locale: UserLocale;
}

/**
 * Emite o par access+refresh.
 *
 * Extraído porque três fluxos precisam dele — login, refresh e o consumo de
 * `set_initial_password` — e porque a construção da FAMÍLIA é onde o desenho
 * pode ser sutilmente traído: um refresh que emite família nova em vez de
 * herdar a existente quebra a detecção de reuso sem quebrar nenhum teste
 * feliz.
 *
 * `locale` (fundação de i18n, Onda 6a) é lido daqui — o ÚNICO choke point dos
 * três fluxos — em vez de exigir que cada chamador busque o usuário. É assim
 * que o payload de login/refresh carrega o idioma sem exigir uma chamada
 * extra da web só para descobri-lo (`apps/web/src/lib/idioma.ts` lê deste
 * mesmo corpo). Usuário não encontrado (não deveria acontecer aqui — a
 * autenticação já validou a conta) degrada para o default do banco, nunca
 * lança: idioma é preferência de exibição, não deve derrubar o login.
 */
@Injectable()
export class EmitirSessaoUseCase {
  constructor(
    private readonly accessTokens: AccessTokenIssuer,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokenFactory: TokenFactory,
    private readonly usuarios: UserRepository,
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

    const usuario = await this.usuarios.findById(entrada.userId);

    return {
      accessToken: acesso.token,
      refreshToken: refresh.bruto,
      expiresIn: acesso.expiresIn,
      locale: usuario?.locale ?? 'pt-BR',
    };
  }
}
