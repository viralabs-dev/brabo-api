import { Injectable } from '@nestjs/common';
import { AgentAreaRepository } from '../../ports/agent-area-repository.port';

/**
 * As áreas de agente de um projeto, para a tela de Configurações (FASE 14d).
 *
 * Desde a RN-094 o projeto nasce com as três áreas, e a lista vem cheia mesmo
 * antes de existir `module_map`: o que a ativação acrescenta são os MEMBROS da
 * área de dev, não a área. Vazio aqui deixou de ser normal — é projeto que a
 * migração de backfill não alcançou.
 */
@Injectable()
export class ListAgentAreasUseCase {
  constructor(private readonly areas: AgentAreaRepository) {}

  execute(projectId: string) {
    return this.areas.listByProject(projectId);
  }
}
