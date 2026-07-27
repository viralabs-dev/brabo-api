import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuthCredentialRepository } from '../../ports/auth-credential-repository.port';
import { AuthEventRecorder } from '../../ports/auth-event-recorder.port';
import { LoginThrottle } from '../../ports/login-throttle.port';
import { PasswordHasher } from '../../ports/password-hasher.port';
import { assuntoDoUsuario } from '../../../domain/auth/auth-event';
import { normalizarEmail } from '../../../domain/auth/email';
import { baldeDeEmail } from '../../../infrastructure/security/auth-key-material';
import { AccountTokenRepository } from '../../ports/account-token-repository.port';
import { MailSender } from '../../ports/mail-sender.port';
import {
  authConfig,
  falhaDeCredencial,
  type ContextoDaRequisicao,
} from './auth-config';
import { TokenFactory } from './token-factory';
import {
  EmitirSessaoUseCase,
  type SessaoEmitida,
} from './emitir-sessao.use-case';

/**
 * Login (Fase 7a, itens 1 e 2).
 *
 * ## A invariante que rege tudo
 *
 * > Qualquer resposta diferente da falha uniforme só pode ser alcançada
 * > DEPOIS de uma verificação de senha bem-sucedida.
 *
 * Ela resolve sozinha todos os casos, inclusive os que costumam escapar:
 * e-mail inexistente, senha errada, conta bloqueada, conta desabilitada e —
 * o mais traiçoeiro — usuário importado do Keycloak que ainda não tem senha.
 * Responder "defina sua senha" a esse último confirmaria que o endereço
 * existe E que é conta legada, o sinal de enumeração mais valioso do sistema.
 *
 * ## A ordem dos passos É a mitigação
 *
 * A busca da credencial e o `verify` do argon2 rodam SEMPRE — inclusive
 * quando o e-mail não existe (verificando contra o hash dummy) e inclusive
 * quando o balde já está bloqueado. A checagem de bloqueio por e-mail vem
 * DEPOIS do verify, não antes.
 *
 * Sair mais cedo é o instinto de qualquer revisor ("não faça trabalho caro à
 * toa") e é exatamente o vazamento: o ramo barato responde em ~1 ms contra os
 * ~50 ms do caro, e o relógio entrega o que o corpo uniforme esconde.
 *
 * A única saída antecipada é a do balde de IP, e por um motivo oposto: ali
 * nada está sendo escondido (o histórico é do próprio requisitante), e rodar
 * argon2 seria entregar a exaustão de CPU que o balde de IP existe para
 * impedir — 19 MiB e um núcleo por tentativa, numa rota pública.
 */
@Injectable()
export class LoginUseCase {
  constructor(
    private readonly credenciais: AuthCredentialRepository,
    private readonly hasher: PasswordHasher,
    private readonly throttle: LoginThrottle,
    private readonly eventos: AuthEventRecorder,
    private readonly emitirSessao: EmitirSessaoUseCase,
    private readonly tokensDeConta: AccountTokenRepository,
    private readonly mail: MailSender,
    private readonly tokenFactory: TokenFactory,
  ) {}

  async execute(entrada: {
    email: string;
    senha: string;
    contexto?: ContextoDaRequisicao;
  }): Promise<SessaoEmitida> {
    const emailNormalizado = normalizarEmail(entrada.email);
    const chaveEmail = baldeDeEmail(emailNormalizado);
    const ip = entrada.contexto?.ip ?? null;

    // 1. Balde de IP — saída rápida, sem argon2.
    if (ip) {
      const balde = await this.throttle.registrarEContar(`ip:${ip}`);
      if (balde.bloqueadoAte) {
        await this.eventos.registrar({
          kind: 'login_blocked_ip',
          subjectKey: chaveEmail,
          ip,
          metadata: { falhas: balde.falhas },
        });
        throw falhaDeCredencial();
      }
    }

    // 2. Balde do e-mail — registrado OTIMISTA, antes de saber o desfecho.
    //    Assim o caminho de falha não paga uma segunda ida ao banco, e mil
    //    requisições paralelas não leem todas "zero" antes de qualquer uma
    //    escrever. O sucesso limpa o balde no passo 7.
    const baldeEmail = await this.throttle.registrarEContar(chaveEmail);

    // 3-5. SEMPRE: busca, escolhe o hash (real ou dummy) e verifica.
    //
    // Uma consulta só (LEFT JOIN), com três desfechos de custo igual: usuário
    // inexistente, usuário SEM senha (conta migrada do Keycloak) e usuário com
    // senha. Duas consultas encadeadas fariam o ramo do meio pagar uma ida a
    // mais ao banco, e o relógio distinguiria conta migrada de e-mail
    // inexistente.
    const achado = await this.credenciais.findByEmail(emailNormalizado);
    const credencial = achado?.credencial ?? null;
    const hashParaVerificar = credencial?.passwordHash ?? this.hasher.dummyHash;
    const senhaConfere = await this.hasher.verify(
      hashParaVerificar,
      entrada.senha,
    );

    // 6. Só agora o bloqueio por e-mail é avaliado — depois de o tempo já ter
    //    sido gasto.
    if (baldeEmail.bloqueadoAte) {
      await this.eventos.registrar({
        kind: 'login_blocked_user',
        subjectKey: chaveEmail,
        userId: achado?.userId ?? null,
        ip,
        metadata: { falhas: baldeEmail.falhas },
      });
      throw falhaDeCredencial();
    }

    // Conta migrada do Keycloak: existe, mas nunca teve senha nesta api.
    //
    // A resposta é o 401 UNIFORME, igual à de e-mail inexistente. Responder
    // "defina sua senha" seria confirmar que o endereço existe E que é conta
    // legada — o sinal de enumeração mais valioso do sistema, e exatamente o
    // que a RN-032 fecha. O usuário recebe o link mesmo assim; a tela de login
    // exibe "confira seu e-mail" como texto fixo, derivado de nenhum sinal do
    // servidor.
    if (achado && !credencial) {
      await this.enviarDefinicaoDeSenha(achado.userId, achado.email, ip);
      await this.eventos.registrar({
        kind: 'login_failure',
        subjectKey: chaveEmail,
        userId: achado.userId,
        ip,
        metadata: { falhas: baldeEmail.falhas, pendente: true },
      });
      throw falhaDeCredencial();
    }

    // Um único ramo sobre booleanos já calculados. Retornos separados por
    // condição convidam alguém a dar uma mensagem específica a um deles
    // depois — e a diferença de alocações e de log entre eles já é medível.
    if (!credencial || !senhaConfere || credencial.disabledAt) {
      await this.eventos.registrar({
        kind: 'login_failure',
        subjectKey: chaveEmail,
        userId: achado?.userId ?? null,
        ip,
        metadata: { falhas: baldeEmail.falhas },
      });
      throw falhaDeCredencial();
    }

    // 7. Daqui para baixo a senha JÁ está provada, então diferenciar a
    //    resposta não vaza existência: quem chegou aqui já sabe a senha.
    if (!credencial.emailVerifiedAt) {
      throw new ForbiddenException('E-mail ainda não verificado.');
    }

    // Limpa SÓ o balde do e-mail. O de IP drena por tempo: limpá-lo no
    // sucesso deixaria quem tem uma conta válida zerar a janela à vontade —
    // logar, pulverizar palpites em outras contas, logar de novo, sem limite.
    await this.throttle.limpar(chaveEmail);

    await this.eventos.registrar({
      kind: 'login_success',
      subjectKey: assuntoDoUsuario(credencial.userId),
      userId: credencial.userId,
      ip,
      userAgent: entrada.contexto?.userAgent,
    });

    return this.emitirSessao.execute({
      userId: credencial.userId,
      email: achado!.email,
      contexto: entrada.contexto,
    });
  }

  /**
   * Dispara o link de definição de senha para uma conta migrada.
   *
   * Sob o MESMO balde do pedido de reset, e só quando não há link vivo. Sem as
   * duas travas, tentar logar num endereço migrado viraria mail bomb — e um
   * amplificador de tempo, já que emitir token é um INSERT que o ramo de
   * e-mail inexistente não paga.
   *
   * A falha de envio é engolida de propósito: o usuário não pode descobrir
   * pela resposta que algo foi tentado, e o desfecho dele é o 401 uniforme de
   * qualquer forma. O que importa é que a trilha registre.
   */
  private async enviarDefinicaoDeSenha(
    userId: string,
    email: string,
    ip: string | null,
  ): Promise<void> {
    try {
      const balde = await this.throttle.registrarEContar(
        `reset_${baldeDeEmail(email)}`,
      );
      if (balde.bloqueadoAte) return;
      if (await this.tokensDeConta.existeVivo(userId, 'set_initial_password')) {
        return;
      }

      const token = this.tokenFactory.gerar();
      const expiraEm = new Date(
        Date.now() + authConfig.definicaoDeSenhaTtlMs(),
      );

      await this.tokensDeConta.emitir({
        userId,
        purpose: 'set_initial_password',
        tokenHash: token.hash,
        expiresAt: expiraEm,
        ip,
      });
      await this.mail.enviar({
        para: email,
        tipo: 'set_initial_password',
        token: token.bruto,
        expiraEm,
      });
    } catch {
      // Ver o docblock: nada aqui pode mudar a resposta ao cliente.
    }
  }
}
