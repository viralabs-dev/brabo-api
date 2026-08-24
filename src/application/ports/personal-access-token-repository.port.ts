export interface NovoPat {
  userId: string;
  projectId: string;
  name: string;
  tokenHash: string;
  expiresAt: Date | null;
}

export interface PatValidado {
  id: string;
  userId: string;
  projectId: string;
}

export interface PatResumo {
  id: string;
  name: string;
  projectId: string;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

/**
 * A visão de `maintainer` (RN-427) — carrega o DONO do token, porque "revogar
 * token de quem?" numa resposta a incidente exige saber quem é. `PatResumo`
 * nunca carrega isso de propósito: é a visão do próprio usuário sobre os
 * PRÓPRIOS tokens, que já sabe de quem eles são.
 */
export interface PatResumoComDono extends PatResumo {
  userId: string;
  userEmail: string;
}

export abstract class PersonalAccessTokenRepository {
  /**
   * Emite um Personal Access Token novo. Diferente de `AccountTokenRepository`,
   * NÃO faz supersede — vários tokens vivos por usuário+projeto ao mesmo
   * tempo são o ponto (um por máquina), não um descuido.
   */
  abstract emitir(novo: NovoPat): Promise<PatResumo>;

  /**
   * Válido = existe, não revogado, não expirado — colapsados na MESMA
   * consulta (mesmo padrão de `AccountTokenRepository.consumir`): quem
   * apresenta um token roubado/expirado não descobre qual dos três é o
   * motivo. `last_used_at` é atualizado incondicionalmente quando válido,
   * sem throttle — um UPDATE de uma linha por índice único não é carga
   * real, e throttlar no MESMO WHERE da validação rejeitaria um token
   * válido reapresentado antes da janela de throttle passar.
   *
   * Escopo de projeto (`runner:project:<id>`) NÃO é checado aqui — é
   * responsabilidade de quem chama (`PatAuthGuard`) comparar
   * `PatValidado.projectId` com o projeto da rota, porque um token válido
   * pro projeto errado é uma categoria de erro diferente (403, não 401).
   */
  abstract validarEUsar(tokenHash: string): Promise<PatValidado | null>;

  /** Escopado ao usuário no WHERE da consulta — nunca filtrado depois de trazer tudo. */
  abstract listarDoUsuarioNoProjeto(
    userId: string,
    projectId: string,
  ): Promise<PatResumo[]>;

  /**
   * Idempotente: revogar um token já revogado devolve a linha (sem erro).
   * `null` = não existe OU não pertence a `userId` — mesma resposta pros
   * dois casos, não vaza a existência de um token alheio.
   */
  abstract revogar(
    id: string,
    userId: string,
    motivo: string,
  ): Promise<PatResumo | null>;

  /**
   * Visão de `maintainer` (RN-427): TODOS os tokens do projeto, de QUALQUER
   * usuário — escopado ao projeto no WHERE, nunca ao usuário chamador.
   */
  abstract listarDoProjeto(projectId: string): Promise<PatResumoComDono[]>;

  /**
   * Revoga QUALQUER token do projeto, não só o do usuário chamador — mesmo
   * desenho idempotente de `revogar()`, mas o WHERE compara `project_id`,
   * nunca `user_id`. `null` = não existe OU é de outro projeto — mesma
   * resposta pros dois casos, mesma disciplina de não vazar existência.
   */
  abstract revogarComoMaintainer(
    id: string,
    projectId: string,
    motivo: string,
  ): Promise<PatResumo | null>;
}
