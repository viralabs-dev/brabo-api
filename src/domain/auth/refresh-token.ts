/**
 * Regras de família de refresh token (Fase 7a, item 1).
 *
 * Puro: recebe o estado de uma linha e classifica. Quem trava a linha e quem
 * escreve é o repositório — aqui está só a decisão, que é a parte que precisa
 * ser óbvia de ler e impossível de errar por ordem.
 */

export interface EstadoDoRefresh {
  rotatedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
  familyStartedAt: Date;
}

export type ClassificacaoDoRefresh =
  /** Não existe token com esse hash. */
  | 'desconhecido'
  /** A família já foi morta por outro motivo — vítima a jusante, sem novo alarme. */
  | 'revogado'
  /** Token já gasto sendo reapresentado — assinatura de roubo. Cascata. */
  | 'reuso'
  /** Passou do próprio prazo. Normal, não é ataque. */
  | 'expirado'
  /** A família passou do teto absoluto. */
  | 'familia_expirada'
  | 'ok';

/**
 * Classifica um refresh apresentado.
 *
 * ## A ordem das perguntas é a regra
 *
 * `revogado` vem ANTES de `reuso`, e trocar isso quebra o sistema de um jeito
 * que passa nos testes felizes: quando uma família morre por reuso, todos os
 * seus tokens ficam com `revoked_at` E muitos com `rotated_at`. Se `reuso`
 * fosse perguntado primeiro, cada aba que o usuário legítimo ainda tem aberta
 * dispararia uma nova "detecção de roubo", enchendo o log de segurança de
 * alarme falso justamente durante o incidente — que é quando ele precisa estar
 * legível.
 *
 * `expirado` vem DEPOIS de `reuso` pelo motivo oposto: um token roubado que
 * também expirou ainda é evidência de roubo, e a cascata precisa rodar.
 */
export function classificar(
  estado: EstadoDoRefresh | null,
  agora: Date,
  tetoAbsolutoMs: number,
): ClassificacaoDoRefresh {
  if (!estado) return 'desconhecido';
  if (estado.revokedAt) return 'revogado';
  if (estado.rotatedAt) return 'reuso';
  if (estado.expiresAt.getTime() <= agora.getTime()) return 'expirado';
  if (estado.familyStartedAt.getTime() + tetoAbsolutoMs <= agora.getTime()) {
    return 'familia_expirada';
  }
  return 'ok';
}
