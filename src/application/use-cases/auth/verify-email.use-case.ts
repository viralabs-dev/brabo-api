import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountTokenRepository } from '../../ports/account-token-repository.port';
import { AuthCredentialRepository } from '../../ports/auth-credential-repository.port';
import { AuthEventRecorder } from '../../ports/auth-event-recorder.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { assuntoDoUsuario } from '../../../domain/auth/auth-event';
import type { ContextoDaRequisicao } from './auth-config';
import { TokenFactory } from './token-factory';

/**
 * Verificação de e-mail (Fase 7a, item 3).
 *
 * Consumo de uso único pelo UPDATE condicional do repositório. Zero linhas
 * cobre inexistente, expirado, já consumido e invalidado — todos com a mesma
 * resposta, porque distinguir "já usado" de "expirado" contaria a quem roubou
 * o link se a vítima chegou primeiro.
 */
@Injectable()
export class VerifyEmailUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly tokensDeConta: AccountTokenRepository,
    private readonly credenciais: AuthCredentialRepository,
    private readonly eventos: AuthEventRecorder,
    private readonly tokenFactory: TokenFactory,
  ) {}

  async execute(entrada: {
    token: string;
    contexto?: ContextoDaRequisicao;
  }): Promise<void> {
    const hash = this.tokenFactory.hashDe(entrada.token);

    await this.unitOfWork.runInTransaction(async () => {
      const consumido = await this.tokensDeConta.consumir({
        tokenHash: hash,
        purpose: 'email_verification',
        ip: entrada.contexto?.ip,
      });

      if (!consumido) {
        throw new BadRequestException('Link inválido ou expirado.');
      }

      await this.credenciais.marcarEmailVerificado(consumido.userId);
      await this.eventos.registrar({
        kind: 'email_verified',
        subjectKey: assuntoDoUsuario(consumido.userId),
        userId: consumido.userId,
        ip: entrada.contexto?.ip,
      });
    });
  }
}
