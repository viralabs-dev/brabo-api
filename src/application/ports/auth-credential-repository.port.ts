export interface AuthCredential {
  id: string;
  userId: string;
  passwordHash: string;
  passwordUpdatedAt: Date;
  emailVerifiedAt: Date | null;
  disabledAt: Date | null;
}

/**
 * O que a busca por e-mail devolve.
 *
 * `credencial: null` significa **usuário sem senha** — na prática, conta
 * importada do Keycloak que ainda não passou pelo "definir senha" (Fase 7a,
 * item 4). É estado DERIVADO: não existe coluna `password_pending` para
 * dessincronizar, e a idempotência do script de migração sai de graça.
 */
export interface UsuarioComCredencial {
  userId: string;
  email: string;
  credencial: AuthCredential | null;
}

export abstract class AuthCredentialRepository {
  /**
   * Busca pela forma NORMALIZADA do e-mail, numa consulta só.
   *
   * O LEFT JOIN não é elegância: é o que mantém o custo IGUAL nos três
   * desfechos possíveis (inexistente, pendente, com senha). Buscar a
   * credencial e depois, só quando ela falta, buscar o usuário faria o ramo
   * pendente pagar uma ida a mais ao banco — e o relógio distinguiria "conta
   * migrada" de "e-mail que não existe", que é exatamente o oráculo que a
   * RN-032 fecha.
   */
  abstract findByEmail(
    emailNormalizado: string,
  ): Promise<UsuarioComCredencial | null>;

  abstract findByUserId(userId: string): Promise<AuthCredential | null>;

  /** Cria usuário e credencial juntos. Chamada dentro de transação. */
  abstract criarUsuarioComCredencial(entrada: {
    email: string;
    name: string | null;
    passwordHash: string;
  }): Promise<UsuarioComCredencial>;

  /**
   * Define a senha — CRIANDO a credencial se não houver.
   *
   * O usuário migrado do Keycloak não tem linha em `auth_credentials`, e um
   * UPDATE puro afetaria zero linhas em silêncio.
   */
  abstract trocarSenha(userId: string, passwordHash: string): Promise<void>;

  abstract marcarEmailVerificado(userId: string): Promise<void>;

  /** Usuários vindos do Keycloak que ainda não têm senha. Ver o script de migração. */
  abstract listarPendentesDeSenha(): Promise<
    { userId: string; email: string }[]
  >;
}
