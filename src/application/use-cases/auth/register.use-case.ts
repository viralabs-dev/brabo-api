import { ForbiddenException, Injectable } from '@nestjs/common';
import { AccountTokenRepository } from '../../ports/account-token-repository.port';
import { AuthCredentialRepository } from '../../ports/auth-credential-repository.port';
import { AuthEventRecorder } from '../../ports/auth-event-recorder.port';
import { MailSender } from '../../ports/mail-sender.port';
import { PasswordHasher } from '../../ports/password-hasher.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { assuntoDoUsuario } from '../../../domain/auth/auth-event';
import { normalizarEmail } from '../../../domain/auth/email';
import { exigirSenhaValida } from '../../../domain/auth/password-policy';
import { baldeDeEmail } from '../../../infrastructure/security/auth-key-material';
import { authConfig, type ContextoDaRequisicao } from './auth-config';
import { TokenFactory } from './token-factory';

/**
 * Registro (Fase 7a, itens 1 e 3).
 *
 * ## Por que a resposta é sempre a mesma
 *
 * E-mail novo e e-mail já cadastrado devolvem a MESMA resposta de aceite. Um
 * `409 Conflict` — que é o que o bom senso de API REST pede — transmitiria a
 * lista inteira de usuários para quem tiver uma wordlist. Fechar a enumeração
 * no login e deixar o registro aberto não fecha nada: o atacante só troca de
 * porta.
 *
 * O custo é de produto e está assumido: a web não pode dizer "esse e-mail já
 * está em uso" no formulário; ela diz "se o endereço estiver disponível,
 * enviamos um e-mail de confirmação".
 *
 * ## O tempo também precisa bater
 *
 * O ramo novo roda um argon2 HASH (~50 ms). O ramo duplicado, portanto,
 * também roda — com os mesmos parâmetros, e é `hash`, não `verify`, para
 * casar a operação. Sem isso, o registro vira o oráculo que o login não é.
 */
@Injectable()
export class RegisterUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly credenciais: AuthCredentialRepository,
    private readonly tokensDeConta: AccountTokenRepository,
    private readonly hasher: PasswordHasher,
    private readonly mail: MailSender,
    private readonly eventos: AuthEventRecorder,
    private readonly tokenFactory: TokenFactory,
  ) {}

  async execute(entrada: {
    email: string;
    senha: string;
    nome?: string | null;
    contexto?: ContextoDaRequisicao;
  }): Promise<void> {
    if (!authConfig.registroHabilitado()) {
      throw new ForbiddenException('O cadastro está fechado.');
    }

    const emailNormalizado = normalizarEmail(entrada.email);

    // A política de senha é avaliada ANTES de olhar se o e-mail existe. Ela
    // não depende da conta, então recusar aqui não diz nada sobre existência
    // — e deixar para depois faria a validação virar um segundo canal.
    exigirSenhaValida(entrada.senha, emailNormalizado);

    const existente = await this.credenciais.findByEmail(emailNormalizado);

    if (existente) {
      // Gasta o mesmo tempo do ramo que cria, e avisa o dono do endereço em
      // vez de contar ao visitante que ele existe.
      await this.hasher.hash(entrada.senha);
      await this.eventos.registrar({
        kind: 'register_duplicate',
        subjectKey: baldeDeEmail(emailNormalizado),
        userId: existente.userId,
        ip: entrada.contexto?.ip,
      });
      await this.mail.enviar({
        para: emailNormalizado,
        tipo: 'register_duplicate',
      });
      return;
    }

    const passwordHash = await this.hasher.hash(entrada.senha);
    const verificacao = this.tokenFactory.gerar();
    const expiraEm = new Date(Date.now() + authConfig.verificacaoTtlMs());

    // Usuário, credencial e token de verificação numa transação só: um usuário
    // sem credencial seria uma conta inacessível que ainda por cima bloqueia o
    // próprio e-mail pelo índice único.
    await this.unitOfWork.runInTransaction(async () => {
      const criada = await this.credenciais.criarUsuarioComCredencial({
        email: emailNormalizado,
        name: entrada.nome ?? null,
        passwordHash,
      });
      await this.tokensDeConta.emitir({
        userId: criada.userId,
        purpose: 'email_verification',
        tokenHash: verificacao.hash,
        expiresAt: expiraEm,
        ip: entrada.contexto?.ip,
      });
      await this.eventos.registrar({
        kind: 'register_created',
        subjectKey: assuntoDoUsuario(criada.userId),
        userId: criada.userId,
        ip: entrada.contexto?.ip,
      });
    });

    // Fora da transação: se o envio falhar, a conta já existe e o usuário pode
    // pedir outro link. O inverso — commitar o e-mail e perder a conta — seria
    // um link válido para uma conta que não existe.
    await this.mail.enviar({
      para: emailNormalizado,
      tipo: 'email_verification',
      token: verificacao.bruto,
      expiraEm,
    });
  }
}
