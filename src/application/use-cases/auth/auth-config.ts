import { UnauthorizedException } from '@nestjs/common';

/**
 * Configuração e respostas compartilhadas do auth (Fase 7a).
 *
 * As respostas ficam aqui, em constantes, e não montadas em cada caso de uso.
 * É o que garante que sejam BYTE A BYTE iguais entre os ramos — um `message`
 * levemente diferente num deles é tudo que um atacante precisa para separar
 * "e-mail não existe" de "senha errada", e a diferença passaria despercebida
 * numa revisão de código que olha um arquivo por vez.
 */

/** Resposta única de falha de login. Ver LoginUseCase. */
export function falhaDeCredencial(): UnauthorizedException {
  return new UnauthorizedException('Credenciais inválidas.');
}

/** Resposta única de falha de refresh. */
export function falhaDeRefresh(): UnauthorizedException {
  return new UnauthorizedException('Refresh inválido ou expirado.');
}

export const authConfig = {
  registroHabilitado: () => process.env.AUTH_REGISTRATION_ENABLED !== 'false',

  refreshTtlMs: () =>
    Number(process.env.AUTH_REFRESH_TOKEN_TTL_MS ?? 1_209_600_000),

  /**
   * Teto ABSOLUTO da família, contado do login. Sem ele, rotação a cada 15
   * minutos produz sessão eterna — e ninguém percebe até uma auditoria
   * perguntar quanto tempo uma sessão pode viver.
   */
  refreshTetoAbsolutoMs: () =>
    Number(process.env.AUTH_REFRESH_ABSOLUTE_TTL_MS ?? 2_592_000_000),

  verificacaoTtlMs: () =>
    Number(process.env.AUTH_EMAIL_TOKEN_TTL_MS ?? 172_800_000),

  resetTtlMs: () => Number(process.env.AUTH_RESET_TOKEN_TTL_MS ?? 3_600_000),

  limiarIpTodasTentativas: () =>
    Number(process.env.AUTH_IP_ATTEMPT_THRESHOLD ?? 60),
};

export interface ContextoDaRequisicao {
  ip?: string | null;
  userAgent?: string | null;
}
