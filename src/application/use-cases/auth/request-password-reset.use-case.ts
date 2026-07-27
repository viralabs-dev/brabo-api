import { Injectable } from '@nestjs/common';
import { AccountTokenRepository } from '../../ports/account-token-repository.port';
import { AuthCredentialRepository } from '../../ports/auth-credential-repository.port';
import { AuthEventRecorder } from '../../ports/auth-event-recorder.port';
import { LoginThrottle } from '../../ports/login-throttle.port';
import { MailSender } from '../../ports/mail-sender.port';
import { assuntoDoUsuario } from '../../../domain/auth/auth-event';
import { normalizarEmail } from '../../../domain/auth/email';
import { baldeDeEmail } from '../../../infrastructure/security/auth-key-material';
import { authConfig, type ContextoDaRequisicao } from './auth-config';
import { TokenFactory } from './token-factory';

/**
 * Pedido de reset de senha (Fase 7a, item 3).
 *
 * Resposta idêntica para e-mail conhecido e desconhecido — mesma razão do
 * registro: fechar a enumeração no login e deixar aberta aqui não fecha nada.
 *
 * ## Sobre o tempo
 *
 * Aqui NÃO existe um argon2 para enterrar a diferença: o ramo conhecido faz um
 * INSERT a mais (~0,3 ms) que o desconhecido não faz. Os dois ramos geram e
 * fazem HMAC de 32 bytes, e os dois escrevem no balde do throttle, então a
 * diferença remanescente é só esse INSERT — contra 5 a 50 ms de jitter de rede
 * em qualquer chamada real.
 *
 * Isso é assumido e registrado no ADR, não varrido para baixo do tapete: a
 * afirmação honesta é "a diferença é ordens de grandeza menor do que o ruído
 * do transporte", e não "tempo constante". Se algum dia o modelo de ameaça
 * exigir mais, o caminho é o outbox — enfileirar incondicionalmente e decidir
 * a existência num worker.
 */
@Injectable()
export class RequestPasswordResetUseCase {
  constructor(
    private readonly credenciais: AuthCredentialRepository,
    private readonly tokensDeConta: AccountTokenRepository,
    private readonly throttle: LoginThrottle,
    private readonly mail: MailSender,
    private readonly eventos: AuthEventRecorder,
    private readonly tokenFactory: TokenFactory,
  ) {}

  async execute(entrada: {
    email: string;
    contexto?: ContextoDaRequisicao;
  }): Promise<void> {
    const emailNormalizado = normalizarEmail(entrada.email);
    const chaveEmail = baldeDeEmail(emailNormalizado);
    const ip = entrada.contexto?.ip ?? null;

    // Throttle nos dois ramos, sempre. Sem ele, o e-mail de aviso ao endereço
    // existente vira arma de mail bombing e queima a cota de envio.
    const balde = await this.throttle.registrarEContar(`reset_${chaveEmail}`);
    if (ip) await this.throttle.registrarEContar(`reset_ip:${ip}`);

    // Gera nos DOIS ramos: o custo (32 bytes + HMAC) é idêntico, e descartar
    // no ramo desconhecido é mais barato do que criar uma diferença de tempo.
    const token = this.tokenFactory.gerar();

    if (balde.bloqueadoAte) return;

    const achado = await this.credenciais.findByEmail(emailNormalizado);
    if (!achado || achado.credencial?.disabledAt) return;

    // Conta migrada que ainda não definiu senha usa o propósito próprio: o
    // fluxo é o mesmo, mas a janela é mais longa (ver authConfig) e a trilha
    // distingue "esqueci minha senha" de "nunca tive uma".
    const proposito = achado.credencial
      ? ('password_reset' as const)
      : ('set_initial_password' as const);
    const ttl = achado.credencial
      ? authConfig.resetTtlMs()
      : authConfig.definicaoDeSenhaTtlMs();

    const expiraEm = new Date(Date.now() + ttl);

    await this.tokensDeConta.emitir({
      userId: achado.userId,
      purpose: proposito,
      tokenHash: token.hash,
      expiresAt: expiraEm,
      ip,
    });

    await this.eventos.registrar({
      kind: 'password_reset_requested',
      subjectKey: assuntoDoUsuario(achado.userId),
      userId: achado.userId,
      ip,
    });

    await this.mail.enviar({
      para: emailNormalizado,
      tipo: proposito,
      token: token.bruto,
      expiraEm,
    });
  }
}
