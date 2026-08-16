import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthCredentialRepository } from '../../ports/auth-credential-repository.port';
import { AuthEventRecorder } from '../../ports/auth-event-recorder.port';
import { GitOauthClientRegistry } from '../../ports/git-oauth-client.port';
import { SocialIdentityRepository } from '../../ports/social-identity-repository.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { UserRepository } from '../../ports/user-repository.port';
import { assuntoDoUsuario } from '../../../domain/auth/auth-event';
import { normalizarEmail } from '../../../domain/auth/email';
import {
  verifySocialOauthState,
  type SocialOauthProviderName,
} from '../../../domain/auth/social-oauth-state';
import { resolveOauthStateSecret } from '../../../infrastructure/security/oauth-state-secret';
import type { ContextoDaRequisicao } from './auth-config';
import {
  EmitirSessaoUseCase,
  type SessaoEmitida,
} from './emitir-sessao.use-case';

/**
 * Callback do login social (RN-272..286, ADR 0084).
 *
 * ## As três decisões, nesta ordem
 *
 * 1. **Identidade já conhecida** (`social_identities` tem
 *    `(provider, providerUserId)`) → login direto na conta vinculada.
 * 2. **Identidade nova, e-mail bate com conta existente E o provider marca o
 *    e-mail como VERIFICADO** → vincula à conta existente e loga.
 * 3. **Identidade nova, e-mail bate com conta existente mas NÃO verificado**
 *    → recusa. Um e-mail não verificado não é prova de identidade: qualquer
 *    um pode digitar o e-mail de outra pessoa num provider OAuth. Aceitar
 *    aqui seria abrir account takeover — quem já tem a conta em `X@empresa.com`
 *    não pediu para um GitHub alheio, com aquele endereço só DIGITADO, herdar
 *    a conta.
 * 4. **Identidade nova, sem conta correspondente** → provisiona um usuário
 *    NOVO, sem senha (mesma forma que a migração do Keycloak já deixa — ver
 *    `criarUsuarioSemCredencial`). Aqui o e-mail NÃO PRECISA estar verificado:
 *    não há conta existente para tomar, só uma nova para nascer. Exigir
 *    verificação encareceria o caso comum sem proteger nada.
 *
 * ## Por que o `state` não carrega mais nada
 *
 * O `state` do fluxo de CONEXÃO de git carrega `projectId`/`userId` porque o
 * callback precisa saber ONDE gravar. Aqui não há "onde": a identidade inteira
 * vem do PROVIDER, depois do `exchangeCode`. O `state` só prova que este
 * callback responde a um `buildLoginAuthorizeUrl` que ESTA api emitiu — CSRF
 * do fluxo de login, nada além disso.
 */
@Injectable()
export class SocialLoginCallbackUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly gitOauthClients: GitOauthClientRegistry,
    private readonly socialIdentities: SocialIdentityRepository,
    private readonly credenciais: AuthCredentialRepository,
    private readonly usuarios: UserRepository,
    private readonly eventos: AuthEventRecorder,
    private readonly emitirSessao: EmitirSessaoUseCase,
  ) {}

  async execute(
    provider: SocialOauthProviderName,
    code: string,
    state: string,
    redirectUri: string,
    contexto?: ContextoDaRequisicao,
  ): Promise<SessaoEmitida> {
    // Verificado ANTES de gastar a chamada de rede do `exchangeCode`: um
    // `state` forjado não deveria custar uma ida ao provider.
    verifySocialOauthState(state, resolveOauthStateSecret(), provider);

    const client = this.gitOauthClients.get(provider);
    const tokenResult = await client.exchangeCode(code, redirectUri);
    const identity = await client.fetchIdentity(tokenResult.accessToken);

    return this.unitOfWork.runInTransaction(async () => {
      const existente = await this.socialIdentities.findByProviderAccount(
        provider,
        identity.providerUserId,
      );

      if (existente) {
        return this.entrarComIdentidadeConhecida(
          existente.userId,
          provider,
          contexto,
        );
      }

      const emailNormalizado = identity.email
        ? normalizarEmail(identity.email)
        : null;
      const achado = emailNormalizado
        ? await this.credenciais.findByEmail(emailNormalizado)
        : null;

      if (achado) {
        if (!identity.emailVerified) {
          await this.eventos.registrar({
            kind: 'social_login_denied_unverified_email',
            subjectKey: assuntoDoUsuario(achado.userId),
            userId: achado.userId,
            ip: contexto?.ip,
            userAgent: contexto?.userAgent,
            metadata: { provider },
          });
          throw new ForbiddenException(
            `O e-mail da sua conta ${provider} ainda não está verificado. ` +
              'Verifique-o no provider e tente de novo, ou entre com e-mail e senha.',
          );
        }

        return this.vincularAContaExistente(
          achado.userId,
          achado.email,
          provider,
          identity,
          contexto,
        );
      }

      if (!emailNormalizado) {
        await this.eventos.registrar({
          kind: 'social_login_failure',
          subjectKey: `social:${provider}:${identity.providerUserId}`,
          ip: contexto?.ip,
          userAgent: contexto?.userAgent,
          metadata: { provider, motivo: 'sem_email' },
        });
        throw new BadRequestException(
          `Não foi possível obter um e-mail da sua conta ${provider} para criar sua conta.`,
        );
      }

      return this.provisionarContaNova(
        emailNormalizado,
        provider,
        identity,
        contexto,
      );
    });
  }

  private async entrarComIdentidadeConhecida(
    userId: string,
    provider: SocialOauthProviderName,
    contexto?: ContextoDaRequisicao,
  ): Promise<SessaoEmitida> {
    const credencial = await this.credenciais.findByUserId(userId);
    if (credencial?.disabledAt) {
      await this.eventos.registrar({
        kind: 'social_login_failure',
        subjectKey: assuntoDoUsuario(userId),
        userId,
        ip: contexto?.ip,
        metadata: { provider, motivo: 'conta_desabilitada' },
      });
      throw new ForbiddenException('Conta desabilitada.');
    }

    const usuario = await this.usuarios.findById(userId);
    if (!usuario) {
      // Linha órfã (usuário apagado sem cascatear o vínculo) — defensivo,
      // não deveria acontecer com o FK `onDelete: cascade`.
      throw new ForbiddenException('Conta não encontrada.');
    }

    await this.eventos.registrar({
      kind: 'social_login_success',
      subjectKey: assuntoDoUsuario(userId),
      userId,
      ip: contexto?.ip,
      userAgent: contexto?.userAgent,
      metadata: { provider },
    });

    return this.emitirSessao.execute({
      userId,
      email: usuario.email,
      contexto,
    });
  }

  private async vincularAContaExistente(
    userId: string,
    email: string,
    provider: SocialOauthProviderName,
    identity: {
      providerUserId: string;
      email: string | null;
      login: string | null;
    },
    contexto?: ContextoDaRequisicao,
  ): Promise<SessaoEmitida> {
    const credencial = await this.credenciais.findByUserId(userId);
    if (credencial?.disabledAt) {
      await this.eventos.registrar({
        kind: 'social_login_failure',
        subjectKey: assuntoDoUsuario(userId),
        userId,
        ip: contexto?.ip,
        metadata: { provider, motivo: 'conta_desabilitada' },
      });
      throw new ForbiddenException('Conta desabilitada.');
    }

    await this.socialIdentities.create({
      userId,
      provider,
      providerUserId: identity.providerUserId,
      providerEmail: identity.email,
      providerLogin: identity.login,
    });

    // O provider acabou de provar, independentemente da nossa própria trilha
    // de verificação, que esta pessoa controla este e-mail. Uma conta
    // registrada por senha e nunca verificada ganha o mesmo efeito que
    // clicar no link de verificação teria dado — sem isso, ela continuaria
    // trancada do LOGIN POR SENHA (RN-032) mesmo depois de provar a posse por
    // outro caminho.
    if (credencial && !credencial.emailVerifiedAt) {
      await this.credenciais.marcarEmailVerificado(userId);
    }

    await this.eventos.registrar({
      kind: 'social_login_linked',
      subjectKey: assuntoDoUsuario(userId),
      userId,
      ip: contexto?.ip,
      userAgent: contexto?.userAgent,
      metadata: { provider },
    });

    return this.emitirSessao.execute({ userId, email, contexto });
  }

  private async provisionarContaNova(
    emailNormalizado: string,
    provider: SocialOauthProviderName,
    identity: {
      providerUserId: string;
      email: string | null;
      login: string | null;
    },
    contexto?: ContextoDaRequisicao,
  ): Promise<SessaoEmitida> {
    const criado = await this.credenciais.criarUsuarioSemCredencial({
      email: emailNormalizado,
      name: identity.login,
    });

    await this.socialIdentities.create({
      userId: criado.userId,
      provider,
      providerUserId: identity.providerUserId,
      providerEmail: identity.email,
      providerLogin: identity.login,
    });

    await this.eventos.registrar({
      kind: 'social_login_new_user',
      subjectKey: assuntoDoUsuario(criado.userId),
      userId: criado.userId,
      ip: contexto?.ip,
      userAgent: contexto?.userAgent,
      metadata: { provider },
    });

    return this.emitirSessao.execute({
      userId: criado.userId,
      email: criado.email,
      contexto,
    });
  }
}
