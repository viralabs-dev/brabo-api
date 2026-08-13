/** Uma área de agente, com seus membros (ADR 0053). */
export interface AgentArea {
  id: string;
  projectId: string;
  key: string;
  leadAgentId: string;
  maxParallel: number;
  members: string[];
}

export interface UpsertAreaInput {
  projectId: string;
  key: string;
  leadAgentId: string;
  members: string[];
  /** Omitido preserva o valor atual — o teto é do usuário, não do seeding. */
  maxParallel?: number;
}

/**
 * As áreas de agente por projeto (ADR 0053, FASE 14d).
 *
 * Substitui a lista hardcoded que vivia em `apps/web/src/lib/agents.ts`. O que
 * forçou a troca foi a área de `dev`: os membros dela são um por MÓDULO do
 * `module_map`, decididos pelo Arquiteto, e portanto diferentes em cada
 * projeto — o que não é enumerável em código tem de ser dado.
 */
export abstract class AgentAreaRepository {
  abstract listByProject(projectId: string): Promise<AgentArea[]>;

  abstract findByKey(projectId: string, key: string): Promise<AgentArea | null>;

  /**
   * Cria ou atualiza a área e a lista de membros.
   *
   * Idempotente de propósito: o seeding roda na criação do projeto E em toda
   * ativação de execução (RN-094, `SeedAgentAreasUseCase`), que o usuário pode
   * disparar mais de uma vez, e `module_map` novo troca os membros da área de
   * dev sem criar área duplicada.
   */
  abstract upsert(input: UpsertAreaInput): Promise<AgentArea>;

  /** Só o teto — é o que a tela de Configurações altera. */
  abstract setMaxParallel(
    projectId: string,
    key: string,
    maxParallel: number,
  ): Promise<AgentArea>;
}
