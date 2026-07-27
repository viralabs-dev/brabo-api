import { Injectable } from '@nestjs/common';
import { AuthEventRecorder } from '../../ports/auth-event-recorder.port';
import { RefreshTokenRepository } from '../../ports/refresh-token-repository.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { assuntoDoUsuario } from '../../../domain/auth/auth-event';
import { authConfig, type ContextoDaRequisicao } from './auth-config';
import { TokenFactory } from './token-factory';

/**
 * Logout (Fase 7a, item 1).
 *
 * Revoga a FAMÍLIA do token apresentado, não só o token. Revogar só o token
 * deixaria vivo o filho que uma rotação concorrente acabou de emitir — a
 * sessão sobreviveria ao logout, que é a única coisa que um logout não pode
 * fazer.
 *
 * Não escolhe a resposta pelo desfecho: token inválido e logout bem-sucedido
 * devolvem o mesmo 204. Um logout que responde 401 para token desconhecido
 * vira um oráculo de validade de token, de graça.
 */
@Injectable()
export class LogoutUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly eventos: AuthEventRecorder,
    private readonly tokenFactory: TokenFactory,
  ) {}

  async execute(entrada: {
    refreshToken: string;
    contexto?: ContextoDaRequisicao;
  }): Promise<void> {
    const hash = this.tokenFactory.hashDe(entrada.refreshToken);

    await this.unitOfWork.runInTransaction(async () => {
      const travado = await this.refreshTokens.travarEClassificar(
        hash,
        authConfig.refreshTetoAbsolutoMs(),
      );
      if (!travado) return;

      await this.refreshTokens.revogarFamilia(travado.familyId, 'logout');
      await this.eventos.registrar({
        kind: 'logout',
        subjectKey: assuntoDoUsuario(travado.userId),
        userId: travado.userId,
        ip: entrada.contexto?.ip,
        metadata: { familyId: travado.familyId },
      });
    });
  }
}
