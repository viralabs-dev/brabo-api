export interface AuthCredential {
  id: string;
  userId: string;
  passwordHash: string;
  passwordUpdatedAt: Date;
  emailVerifiedAt: Date | null;
  disabledAt: Date | null;
}

/** Credencial + o e-mail do usuário dono, que é o que o login precisa junto. */
export interface CredencialComUsuario extends AuthCredential {
  email: string;
}

export abstract class AuthCredentialRepository {
  /**
   * Busca pela forma NORMALIZADA do e-mail. Quem normaliza é o caso de uso,
   * com `normalizarEmail` — a mesma função que monta a chave do balde de
   * lockout e que o índice único do banco espelha.
   */
  abstract findByEmail(
    emailNormalizado: string,
  ): Promise<CredencialComUsuario | null>;

  abstract findByUserId(userId: string): Promise<AuthCredential | null>;

  /** Cria usuário e credencial juntos. Chamada dentro de transação. */
  abstract criarUsuarioComCredencial(entrada: {
    email: string;
    name: string | null;
    passwordHash: string;
  }): Promise<CredencialComUsuario>;

  abstract trocarSenha(userId: string, passwordHash: string): Promise<void>;

  abstract marcarEmailVerificado(userId: string): Promise<void>;
}
