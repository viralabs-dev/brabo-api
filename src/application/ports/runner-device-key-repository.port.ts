/**
 * As duas espécies de chave de dispositivo (RN-543, ADR 0154 ponto 1), numa
 * tabela só. `projeto` é a chave do ADR 0118, presa ao projeto que a
 * registrou; `maquina` é a que descreve a MÁQUINA e vale para qualquer
 * projeto do dono dela.
 *
 * Derivada de `projectId` (nulo = máquina) e nunca gravada — mas DITA, e não
 * deixada implícita: a listagem da RN-519 passou a devolver as duas espécies
 * juntas, e "uma de máquina não é a chave do projeto X" é a consequência que
 * o ADR 0154 declara. Quem lê a lista não deve ter de inferir a espécie de um
 * `null`.
 */
export type EspecieDeChaveDeDispositivo = 'projeto' | 'maquina';

export interface NovaChaveDeDispositivo {
  userId: string;
  /**
   * `null` = chave de MÁQUINA (ADR 0154 ponto 1). Nenhuma rota da api
   * produz `null` ainda — quem registra chave de máquina é o `install.sh`
   * (ADR 0155 ponto 4), que é outra sessão desta fase. O tipo é o da
   * COLUNA, não o do chamador de hoje.
   */
  projectId: string | null;
  name: string;
  publicKeyJwk: string;
}

export interface ChaveDeDispositivoResumo {
  id: string;
  name: string;
  /** `null` = chave de MÁQUINA — ver `especie`, que diz isso por extenso. */
  projectId: string | null;
  especie: EspecieDeChaveDeDispositivo;
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
  /**
   * `null` = chave de MÁQUINA: não há projeto a comparar contra o da rota, e
   * a autorização se resolve contra o projeto PEDIDO (ADR 0154 ponto 2). Com
   * um projeto aqui, `PatAuthGuard` continua recusando qualquer outro — é
   * essa comparação que impede a chave do projeto A servir o projeto B, e
   * ela some SÓ para `null`.
   */
  projectId: string | null;
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
   * Lista as chaves do PRÓPRIO usuário que SERVEM àquele projeto — revogadas
   * INCLUÍDAS, mesma escolha de `listarDoUsuarioNoProjeto` do PAT: quem
   * revogou precisa ver que revogou, e sumir com a linha faria a tela
   * afirmar que a chave nunca existiu. Nunca devolve a JWK pública: a lista
   * existe para revogar, e o navegador que registrou já tem a dele.
   *
   * "Servem" e não "são daquele projeto" desde a RN-543: as de MÁQUINA
   * (`project_id NULL`) entram também, marcadas pela `especie`. Sem isso
   * elas seriam invisíveis em TODA listagem — que é exatamente o defeito que
   * a RN-519 fechou ("ninguém revoga o que não consegue ver"), renascido na
   * espécie nova. A revogação já as alcança sem código novo: `revogar` casa
   * por `{id, userId}` e nunca por projeto.
   */
  abstract listarDoUsuarioNoProjeto(
    userId: string,
    projectId: string,
  ): Promise<ChaveDeDispositivoResumo[]>;

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

  /**
   * Revoga TODAS as chaves de MÁQUINA ativas de um usuário e devolve os ids
   * do que revogou (RN-552, ADR 0155 ponto 4). Vazio quando não havia
   * nenhuma — o caso normal de uma instalação nova.
   *
   * Existe para que registrar uma chave de máquina SUBSTITUA em vez de
   * ACUMULAR: sem isso, a rota interna do instalador viraria fábrica de
   * credenciais duradouras, e uma máquina reinstalada — que é caso legítimo —
   * deixaria para trás uma chave viva que ninguém consegue alcançar (revogar
   * pela tela pede um `projectId`, e uma instalação recém-criada não tem
   * projeto).
   *
   * Só as de MÁQUINA (`project_id IS NULL`): as de PROJETO nasceram do
   * navegador, num fluxo que esta rota não conhece, e derrubá-las seria
   * apagar o pareamento de quem já usa o produto.
   */
  abstract revogarChavesDeMaquina(
    userId: string,
    motivo: string,
  ): Promise<string[]>;

  /** Análogo ao `last_used_at` do PAT — tocado sem throttle a cada uso válido. */
  abstract tocarUso(id: string): Promise<void>;
}
