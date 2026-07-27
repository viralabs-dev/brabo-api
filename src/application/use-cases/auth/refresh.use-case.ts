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
import {
  EmitirSessaoUseCase,
  type SessaoEmitida,
} from './emitir-sessao.use-case';
import { TokenFactory } from './token-factory';

/** A transação DEVOLVE o desfecho; quem lança é o chamador, já commitado. */
type Desfecho = { tipo: 'ok'; sessao: SessaoEmitida } | { tipo: 'falha' };

/**
 * Rotação do refresh, com detecção de reuso (Fase 7a, item 1).
 *
 * ## Por que a falha não é lançada de dentro da transação
 *
 * Porque a detecção de reuso PRECISA persistir: ela revoga a família e grava o
 * evento de segurança. Lançar lá dentro faria o rollback desfazer as duas
 * coisas — a resposta ao cliente seria 401 do mesmo jeito, mas a cascata nunca
 * teria acontecido e o log de segurança ficaria vazio. A detecção viraria
 * teatro, e o sintoma seria invisível: o teste de caminho feliz passa, o
 * atacante continua com um token que funciona, e ninguém descobre.
 *
 * Foi exatamente esse o defeito que o teste "dois clientes na mesma família"
 * encontrou nesta implementação. Por isso a transação devolve um `Desfecho` e
 * quem lança é o código depois do commit.
 *
 * ## Quem vence o duplo-submit
 *
 * O primeiro a commitar. O segundo encontra `rotated_at` preenchido e é
 * tratado como reuso — a família morre e o usuário loga de novo.
 *
 * Deliberado, e sem conserto do lado do servidor: um duplo-submit legítimo e
 * um replay de ladrão são idênticos aqui. Mesmo token, mesma rota, muitas
 * vezes o mesmo IP. Sem sinal para separar, a política segura é assumir roubo.
 * A correção mora no cliente — refresh em single-flight, uma promessa em voo
 * compartilhada. É requisito da 7.2, não detalhe de implementação.
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
    const desfecho = await this.unitOfWork.runInTransaction(() =>
      this.decidir(entrada),
    );

    if (desfecho.tipo === 'falha') throw falhaDeRefresh();
    return desfecho.sessao;
  }

  private async decidir(entrada: {
    refreshToken: string;
    contexto?: ContextoDaRequisicao;
  }): Promise<Desfecho> {
    const hash = this.tokenFactory.hashDe(entrada.refreshToken);
    const ip = entrada.contexto?.ip ?? null;

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
      return { tipo: 'falha' };
    }

    const assunto = assuntoDoUsuario(travado.userId);

    switch (travado.classificacao) {
      case 'reuso': {
        // A cascata. O usuário legítimo é deslogado junto — comportamento
        // certo, e documentado para não ser lido como bug.
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
        return { tipo: 'falha' };
      }

      case 'revogado':
        // Vítima a jusante de uma cascata alheia: NÃO dispara nova cascata nem
        // novo alarme. Sem esta distinção, cada aba do usuário legítimo geraria
        // uma "detecção de roubo" durante o incidente.
        await this.eventos.registrar({
          kind: 'refresh_revoked',
          subjectKey: assunto,
          userId: travado.userId,
          ip,
        });
        return { tipo: 'falha' };

      case 'expirado':
        await this.eventos.registrar({
          kind: 'refresh_expired',
          subjectKey: assunto,
          userId: travado.userId,
          ip,
        });
        return { tipo: 'falha' };

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
        return { tipo: 'falha' };

      case 'desconhecido':
        return { tipo: 'falha' };

      case 'ok':
        break;
    }

    const credencial = await this.credenciais.findByUserId(travado.userId);
    if (credencial?.disabledAt) {
      await this.refreshTokens.revogarFamilia(travado.familyId, 'logout');
      return { tipo: 'falha' };
    }

    const usuario = await this.usuarios.findById(travado.userId);
    if (!usuario) return { tipo: 'falha' };

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
    const sessao = await this.emitirSessao.execute({
      userId: travado.userId,
      email: usuario.email,
      familyId: travado.familyId,
      familyStartedAt: travado.familyStartedAt,
      contexto: entrada.contexto,
    });

    return { tipo: 'ok', sessao };
  }
}
