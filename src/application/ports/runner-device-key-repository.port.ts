export interface NovaChaveDeDispositivo {
  userId: string;
  projectId: string;
  name: string;
  publicKeyJwk: string;
}

export interface ChaveDeDispositivoResumo {
  id: string;
  name: string;
  projectId: string;
  createdAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

/**
 * O que o guard precisa pra verificar uma assinatura: a chave pública, e a
 * quem ela pertence. NUNCA inclui `revokedAt`/`createdAt` — quem consulta
 * (`PatAuthGuard`) já recebeu isto filtrado por "ativa" na própria consulta,
 * mesmo padrão de `PatValidado` (que também não carrega os campos que já
 * foram usados para decidir "válido").
 */
export interface ChavePublicaAtiva {
  id: string;
  userId: string;
  projectId: string;
  publicKeyJwk: string;
}

export abstract class RunnerDeviceKeyRepository {
  /** Registra a chave pública de um dispositivo novo. Nunca há "bruto" a devolver. */
  abstract registrar(
    nova: NovaChaveDeDispositivo,
  ): Promise<ChaveDeDispositivoResumo>;

  /**
   * Ativa = existe e não revogada — SEM checar expiração, diferente do PAT:
   * chave de dispositivo não expira sozinha, só por revogação explícita
   * (`revogar`). O JWT que o dispositivo assina é que tem TTL curto, não a
   * chave em si.
   */
  abstract buscarChavePublicaAtiva(
    deviceKeyId: string,
  ): Promise<ChavePublicaAtiva | null>;

  /**
   * Idempotente: revogar uma chave já revogada devolve a linha (sem erro).
   * `null` = não existe OU não pertence a `userId` — mesma resposta pros
   * dois casos, não vaza a existência de uma chave alheia.
   */
  abstract revogar(
    id: string,
    userId: string,
    motivo: string,
  ): Promise<ChaveDeDispositivoResumo | null>;

  /** Análogo ao `last_used_at` do PAT — tocado sem throttle a cada uso válido. */
  abstract tocarUso(id: string): Promise<void>;
}
