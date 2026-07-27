import type { ClassificacaoDoRefresh } from '../../domain/auth/refresh-token';

export type MotivoDeRevogacao =
  | 'reuse_detected'
  | 'logout'
  | 'password_reset'
  | 'family_max_age';

export interface RefreshTravado {
  id: string;
  userId: string;
  familyId: string;
  classificacao: ClassificacaoDoRefresh;
}

export interface NovoRefresh {
  userId: string;
  familyId: string;
  tokenHash: string;
  familyStartedAt: Date;
  expiresAt: Date;
  ip?: string | null;
  userAgent?: string | null;
}

export abstract class RefreshTokenRepository {
  /**
   * Trava a linha do token (`select ... for update`) e devolve já classificada.
   *
   * O `for update` é o coração da detecção de reuso, não um detalhe de
   * performance: sem ele, dois refreshes concorrentes com o MESMO token leem
   * "não rotacionado" no mesmo instante, os dois rotacionam, a família se
   * bifurca em silêncio — e um token roubado passa a conviver com o legítimo
   * sem nunca disparar a cascata. Ou seja, a feature inteira vira no-op
   * exatamente na condição para a qual ela existe.
   *
   * Precisa rodar DENTRO de uma transação (UnitOfWork), senão o lock é
   * liberado no fim do próprio statement e não serializa nada.
   */
  abstract travarEClassificar(
    tokenHash: string,
    tetoAbsolutoMs: number,
  ): Promise<RefreshTravado | null>;

  abstract emitir(novo: NovoRefresh): Promise<string>;

  /** Marca o token como consumido normalmente. */
  abstract marcarRotacionado(id: string): Promise<void>;

  /** Revoga a família inteira. Devolve quantos tokens vivos foram atingidos. */
  abstract revogarFamilia(
    familyId: string,
    motivo: MotivoDeRevogacao,
  ): Promise<number>;

  /**
   * Revoga TODAS as famílias do usuário. É o inverso da cascata por reuso: lá
   * a evidência é de uma família só; aqui o usuário disse "acho que alguém
   * entrou na minha conta", e deixar outros dispositivos logados anularia a
   * operação.
   */
  abstract revogarTodasDoUsuario(
    userId: string,
    motivo: MotivoDeRevogacao,
  ): Promise<number>;
}
