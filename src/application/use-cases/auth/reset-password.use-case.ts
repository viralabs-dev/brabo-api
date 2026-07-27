import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountTokenRepository } from '../../ports/account-token-repository.port';
import { AuthCredentialRepository } from '../../ports/auth-credential-repository.port';
import { AuthEventRecorder } from '../../ports/auth-event-recorder.port';
import { LoginThrottle } from '../../ports/login-throttle.port';
import { PasswordHasher } from '../../ports/password-hasher.port';
import { RefreshTokenRepository } from '../../ports/refresh-token-repository.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { UserRepository } from '../../ports/user-repository.port';
import { assuntoDoUsuario } from '../../../domain/auth/auth-event';
import { normalizarEmail } from '../../../domain/auth/email';
import { exigirSenhaValida } from '../../../domain/auth/password-policy';
import { baldeDeEmail } from '../../../infrastructure/security/auth-key-material';
import type { ContextoDaRequisicao } from './auth-config';
import { TokenFactory } from './token-factory';

/**
 * Conclusão do reset de senha (Fase 7a, item 3).
 *
 * Serve também ao `set_initial_password` — o fluxo dos usuários importados do
 * Keycloak, cuja senha não migra (Fase 7, item 4). O propósito é tentado nessa
 * ordem: quem tem um link de reset legítimo usa `password_reset`; quem veio da
 * migração usa `set_initial_password`. O cliente não escolhe, e por isso não
 * consegue usar a escolha para descobrir de que tipo é a conta.
 */
@Injectable()
export class ResetPasswordUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly tokensDeConta: AccountTokenRepository,
    private readonly credenciais: AuthCredentialRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly usuarios: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly throttle: LoginThrottle,
    private readonly eventos: AuthEventRecorder,
    private readonly tokenFactory: TokenFactory,
  ) {}

  async execute(entrada: {
    token: string;
    novaSenha: string;
    contexto?: ContextoDaRequisicao;
  }): Promise<void> {
    const hash = this.tokenFactory.hashDe(entrada.token);

    // O hash da senha nova roda FORA da transação: são ~50 ms e 19 MiB de
    // argon2, e segurar lock de linha mais conexão do pool durante isso é
    // contenção pura. Ele não depende de nada que esteja lá dentro.
    //
    // A política ainda não pode ser validada aqui: ela compara com o e-mail,
    // que só se conhece depois de consumir o token. Por isso o hash é
    // calculado antes e a validação acontece dentro — o custo de um hash
    // descartado numa senha fraca é aceitável, e é o preço de não abrir um
    // canal onde o tempo distingue "token inválido" de "senha fraca".
    const passwordHash = await this.hasher.hash(entrada.novaSenha);

    await this.unitOfWork.runInTransaction(async () => {
      const consumido =
        (await this.tokensDeConta.consumir({
          tokenHash: hash,
          purpose: 'password_reset',
          ip: entrada.contexto?.ip,
        })) ??
        (await this.tokensDeConta.consumir({
          tokenHash: hash,
          purpose: 'set_initial_password',
          ip: entrada.contexto?.ip,
        }));

      if (!consumido) {
        throw new BadRequestException('Link inválido ou expirado.');
      }

      const usuario = await this.usuarios.findById(consumido.userId);
      if (!usuario) throw new BadRequestException('Link inválido ou expirado.');

      exigirSenhaValida(entrada.novaSenha, usuario.email);

      await this.credenciais.trocarSenha(consumido.userId, passwordHash);

      // TODAS as famílias, não só uma. É o inverso da cascata por reuso, e a
      // diferença é o modelo de ameaça: lá a evidência aponta para uma família
      // específica; aqui o usuário disse "acho que entraram na minha conta", e
      // deixar outros dispositivos logados anularia a operação inteira.
      await this.refreshTokens.revogarTodasDoUsuario(
        consumido.userId,
        'password_reset',
      );

      // Os outros links de reset em aberto morrem junto — senão um segundo
      // link, ainda válido, permitiria trocar a senha de novo.
      await this.tokensDeConta.invalidarVivos(
        consumido.userId,
        ['password_reset', 'set_initial_password'],
        'password_changed',
      );

      // O e-mail está comprovadamente sob controle de quem clicou no link.
      await this.credenciais.marcarEmailVerificado(consumido.userId);

      // Destrava a conta: quem acabou de provar posse do e-mail não deve
      // esbarrar num lockout acumulado pelas tentativas do atacante.
      await this.throttle.limpar(baldeDeEmail(normalizarEmail(usuario.email)));

      await this.eventos.registrar({
        kind: 'password_reset_completed',
        subjectKey: assuntoDoUsuario(consumido.userId),
        userId: consumido.userId,
        ip: entrada.contexto?.ip,
      });
    });

    // Sem emitir tokens aqui, de propósito: logar o usuário direto a partir de
    // um link que chegou por e-mail faria comprometer o e-mail equivaler a
    // tomar a conta, sem segundo passo. A web manda para o login.
  }
}
