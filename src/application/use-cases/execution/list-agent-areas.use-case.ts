import { Injectable } from '@nestjs/common';
import { AgentAreaRepository } from '../../ports/agent-area-repository.port';

/**
 * As áreas de agente de um projeto, para a tela de Configurações (FASE 14d).
 *
 * Devolve vazio para projeto que nunca ativou execução, e isso NÃO é erro: as
 * áreas nascem no seeding da ativação, porque os membros da área de dev vêm do
 * `module_map` — antes disso não há o que listar.
 */
@Injectable()
export class ListAgentAreasUseCase {
  constructor(private readonly areas: AgentAreaRepository) {}

  execute(projectId: string) {
    return this.areas.listByProject(projectId);
  }
}
