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
   * Existe QUALQUER usuário nesta instalação? (RN-546, ADR 0155 ponto 1)
   *
   * Pergunta sobre a instalação inteira, não sobre um e-mail — é o que
   * autoriza a rota interna de primeira conta a existir e o que a faz sumir
   * assim que a instalação tem gente. Por isso ela olha `users`, e não
   * `auth_credentials`: conta provisionada por login social (RN-278) nasce
   * SEM credencial, e perguntar pela credencial diria "não há ninguém" numa
   * instalação povoada.
   *
   * `LIMIT 1`, nunca `count(*)`: quem chama só quer saber se o conjunto é
   * vazio, e uma contagem numa tabela que pode ter muitas linhas paga uma
   * varredura para devolver um número que ninguém lê.
   */
  abstract existeAlgumUsuario(): Promise<boolean>;

  /**
   * O ÚNICO usuário desta instalação, ou `null` quando não há exatamente um
   * (RN-552, ADR 0155 ponto 4).
   *
   * Irmã de `existeAlgumUsuario`, e pelo mesmo motivo: é uma pergunta sobre a
   * INSTALAÇÃO, não sobre um usuário. Ela existe para a rota interna que
   * registra a chave de máquina do instalador — que assim não precisa receber
   * um `userId` de quem a chama, e portanto não pode ser APONTADA para uma
   * vítima escolhida. Zero e "mais de um" colapsam no mesmo `null` de
   * propósito: quem chama não decide nada com a diferença, e devolvê-la
   * transformaria a rota num oráculo de quantas pessoas há na instalação.
   *
   * `LIMIT 2`, nunca `count(*)`: duas linhas bastam para distinguir "uma" de
   * "mais de uma", e a contagem pagaria varredura para um número que ninguém
   * lê.
   */
  abstract usuarioUnicoDaInstalacao(): Promise<User | null>;

  /**
   * Grava a preferência de idioma (fundação de i18n, Onda 6a). Único campo de
   * `users` gravável pelo próprio dono da conta hoje — por isso um método
   * dedicado em vez de um `update` genérico, que abriria a porta para
   * gravar `keycloakSub`/`email` por engano.
   */
  abstract updateLocale(id: string, locale: UserLocale): Promise<User>;
}
