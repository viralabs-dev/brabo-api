import { Injectable } from '@nestjs/common';
import { AuthCredentialRepository } from '../../ports/auth-credential-repository.port';
import { AuthEventRecorder } from '../../ports/auth-event-recorder.port';
import { RefreshTokenRepository } from '../../ports/refresh-token-repository.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { UserRepository } from '../../ports/user-repository.port';
import { assuntoDoUsuario } from '../../../domain/auth/auth-event';
import {
  authConfig,
  falhaDeRefresh,
  type ContextoDaRequisicao,
} from './auth-config';
import { EmitirSessaoUseCase, type SessaoEmitida } from './emitir-sessao.use-case';
import { TokenFactory } from './token-factory';

/**
 * Rotação do refresh, com detecção de reuso (Fase 7a, item 1).
 *
 * ## Quem vence o duplo-submit
 *
 * O primeiro a commitar. O segundo encontra `rotated_at` preenchido e é
 * tratado como reuso — a família morre e o usuário precisa logar de novo.
 *
 * Isso é deliberado e não tem conserto do lado do servidor: um duplo-submit
 * legítimo e um replay de ladrão são BYTE A BYTE idênticos aqui. Mesmo token,
 * mesma rota, muitas vezes o mesmo IP. Sem sinal para separar, a política
 * segura é assumir roubo.
 *
 * A correção mora no cliente: a web precisa de refresh em single-flight — uma
 * única promessa em voo compartilhada por todos os chamadores. Sem isso, duas
 * chamadas que levem 401 ao mesmo tempo deslogam o usuário. Isso é requisito
 * da 7.2, não um detalhe de implementação.
 */
@Injectable()
export class RefreshUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly credenciais: AuthCredentialRepository,
    private readonly usuarios: UserRepository,
    private readonly eventos: AuthEventRecorder,
    private readonly emitirSessao: EmitirSessaoUseCase,
    private readonly tokenFactory: TokenFactory,
  ) {}

  async execute(entrada: {
    refreshToken: string;
    contexto?: ContextoDaRequisicao;
  }): Promise<SessaoEmitida> {
    const hash = this.tokenFactory.hashDe(entrada.refreshToken);
    const ip = entrada.contexto?.ip ?? null;

    // Tudo numa transação: é o que dá sentido ao `for update` lá dentro. Fora
    // dela o lock morre no fim do próprio statement e não serializa nada.
    return this.unitOfWork.runInTransaction(async () => {
      const travado = await this.refreshTokens.travarEClassificar(
        hash,
        authConfig.refreshTetoAbsolutoMs(),
      );

      if (!travado) {
        await this.eventos.registrar({
          kind: 'refresh_unknown',
          subjectKey: 'user:desconhecido',
          ip,
        });
        throw falhaDeRefresh();
      }

      const assunto = assuntoDoUsuario(travado.userId);

      switch (travado.classificacao) {
        case 'reuso': {
          // A cascata: alguém apresentou um token já gasto. O usuário legítimo
          // é deslogado junto — é o comportamento certo, e precisa estar na
          // doc para não ser lido como bug.
          const revogados = await this.refreshTokens.revogarFamilia(
            travado.familyId,
            'reuse_detected',
          );
          await this.eventos.registrar({
            kind: 'refresh_reuse_detected',
            subjectKey: assunto,
            userId: travado.userId,
            ip,
            metadata: { familyId: travado.familyId, revogados },
          });
          throw falhaDeRefresh();
        }

        case 'revogado':
          // Vítima a jusante de uma cascata alheia: NÃO dispara nova cascata
          // nem novo alarme. Sem esta distinção, cada aba do usuário legítimo
          // geraria uma "detecção de roubo" durante o incidente.
          await this.eventos.registrar({
            kind: 'refresh_revoked',
            subjectKey: assunto,
            userId: travado.userId,
            ip,
          });
          throw falhaDeRefresh();

        case 'expirado':
          await this.eventos.registrar({
            kind: 'refresh_expired',
            subjectKey: assunto,
            userId: travado.userId,
            ip,
          });
          throw falhaDeRefresh();

        case 'familia_expirada':
          await this.refreshTokens.revogarFamilia(
            travado.familyId,
            'family_max_age',
          );
          await this.eventos.registrar({
            kind: 'refresh_family_expired',
            subjectKey: assunto,
            userId: travado.userId,
            ip,
          });
          throw falhaDeRefresh();

        case 'desconhecido':
          throw falhaDeRefresh();

        case 'ok':
          break;
      }

      const credencial = await this.credenciais.findByUserId(travado.userId);
      if (credencial?.disabledAt) {
        await this.refreshTokens.revogarFamilia(travado.familyId, 'logout');
        throw falhaDeRefresh();
      }

      const usuario = await this.usuarios.findById(travado.userId);
      if (!usuario) throw falhaDeRefresh();

      await this.refreshTokens.marcarRotacionado(travado.id);

      await this.eventos.registrar({
        kind: 'refresh_rotated',
        subjectKey: assunto,
        userId: travado.userId,
        ip,
        metadata: { familyId: travado.familyId },
      });

      // Família e início HERDADOS da linha travada. Emitir família nova aqui
      // quebraria a detecção de reuso sem quebrar nenhum teste feliz; e passar
      // `new Date()` como início reiniciaria o teto absoluto a cada rotação,
      // devolvendo a sessão eterna que ele existe para impedir.
      return this.emitirSessao.execute({
        userId: travado.userId,
        email: usuario.email,
        familyId: travado.familyId,
        familyStartedAt: travado.familyStartedAt,
        contexto: entrada.contexto,
      });
    });
  }
}
