/**
 * Erros do login social (RN-272..286, ADR 0084).
 *
 * `GitProviderAuthError` (domain/git/git-provider-errors.ts) continua sendo
 * lançado por `exchangeCode`/`fetchIdentity` dos clientes OAuth reusados — não
 * duplicado aqui. Os dois erros abaixo são exclusivos deste fluxo.
 */
export class InvalidSocialOauthStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSocialOauthStateError';
  }
}

/**
 * O e-mail devolvido pelo provider bate com uma conta existente, mas o
 * provider não o marca como VERIFICADO — não é prova de identidade
 * suficiente para vincular (ver RN-274 e o comentário em
 * `social-login-callback.use-case.ts`).
 */
export class UnverifiedSocialEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnverifiedSocialEmailError';
  }
}
