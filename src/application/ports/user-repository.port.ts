import type { User } from '../../domain/iam/user.entity';

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
}
