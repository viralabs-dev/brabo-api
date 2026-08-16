/**
 * Tipos de evento da trilha de auth (Fase 7a).
 *
 * União fechada no TypeScript, coluna `text` no banco — mesma escolha de
 * `session_events.type`. Tipo novo não deve custar migração de enum, e o
 * compilador já impede o erro de digitação que o enum pegaria.
 */
export type AuthEventKind =
  // --- login ---
  | 'login_success'
  | 'login_failure'
  /** Barrado pelo balde de IP, antes mesmo de olhar a credencial. */
  | 'login_blocked_ip'
  /** Barrado pelo balde do e-mail (a resposta ao cliente é a mesma de senha errada). */
  | 'login_blocked_user'
  // --- registro ---
  | 'register_created'
  /** Tentativa de registro num e-mail que já existe — nada foi criado. */
  | 'register_duplicate'
  | 'email_verified'
  // --- senha ---
  | 'password_reset_requested'
  | 'password_reset_completed'
  // --- refresh ---
  | 'refresh_rotated'
  | 'refresh_unknown'
  | 'refresh_expired'
  | 'refresh_revoked'
  | 'refresh_family_expired'
  /** Token já gasto reapresentado: a família inteira foi revogada. */
  | 'refresh_reuse_detected'
  | 'logout'
  // --- login social (RN-272..286, ADR 0084) ---
  /** Identidade social já conhecida — login direto. */
  | 'social_login_success'
  /** Nenhuma conta com aquele e-mail: usuário provisionado SEM senha. */
  | 'social_login_new_user'
  /** Conta existente, e-mail do provider VERIFICADO batendo: identidade vinculada. */
  | 'social_login_linked'
  /** E-mail bate com conta existente, mas o provider não o marca verificado. */
  | 'social_login_denied_unverified_email'
  /** Conta desabilitada, ou falha ao falar com o provider. */
  | 'social_login_failure';

export interface AuthEventParaGravar {
  kind: AuthEventKind;
  /** `user:<uuid>` ou `email:<hmac>` — nunca o e-mail em claro. */
  subjectKey: string;
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

/** Chave de assunto de um usuário conhecido. */
export function assuntoDoUsuario(userId: string): string {
  return `user:${userId}`;
}
