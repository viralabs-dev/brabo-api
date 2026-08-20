import type { User, UserLocale } from '../../domain/iam/user.entity';

/**
 * Leitura de usuário.
 *
 * O `upsertFromKeycloak` saiu na Fase 7a junto com o emissor externo: com o
 * auth próprio, quem cria usuário é o registro (`AuthCredentialRepository`),
 * numa transação com a credencial. Não existe mais o caso de "descobrir um
 * usuário novo pelo token" — o token só é emitido para quem já existe.
 */
export abstract class UserRepository {
  abstract findById(id: string): Promise<User | null>;

  /**
   * Grava a preferência de idioma (fundação de i18n, Onda 6a). Único campo de
   * `users` gravável pelo próprio dono da conta hoje — por isso um método
   * dedicado em vez de um `update` genérico, que abriria a porta para
   * gravar `keycloakSub`/`email` por engano.
   */
  abstract updateLocale(id: string, locale: UserLocale): Promise<User>;
}
