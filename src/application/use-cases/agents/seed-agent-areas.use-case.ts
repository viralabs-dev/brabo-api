import { Injectable } from '@nestjs/common';
import {
  AgentAreaRepository,
  type AgentArea,
} from '../../ports/agent-area-repository.port';
import { AGENT_AREAS } from '../../../domain/agents/agent-areas';

/**
 * Grava as áreas do projeto a partir da lista canônica (RN-094).
 *
 * ## Por que isto existe
 *
 * `AgentAreaRepository.upsert` nasceu na FASE 14d sem NENHUM chamador: a
 * tabela ficava vazia, `GET /projects/:id/agent-areas` devolvia `[]`, e os
 * quatro casos de uso que a leem operavam sobre o nada — inclusive o teto de
 * paralelismo, que é o que impede o produto de gastar sem autorização. Testar
 * a peça não é testar o caminho até ela; o caminho não existia.
 *
 * ## Quem chama, e por quê são dois
 *
 * - `CreateProjectUseCase`: a área precisa existir ANTES de qualquer coisa que
 *   a leia, e a tela de Configurações lê num projeto que nunca executou.
 * - `ActivateExecutionUseCase`: é lá que os membros da área de `dev` deixam de
 *   ser desconhecidos — um por módulo do `module_map`, decidido pelo
 *   Arquiteto. Só a ativação sabe quais são.
 *
 * O `upsert` é idempotente e NÃO toca `max_parallel` quando ele é omitido, que
 * é sempre o caso aqui: o teto é decisão do usuário, e semear de novo não pode
 * desfazê-la.
 */
@Injectable()
export class SeedAgentAreasUseCase {
  constructor(private readonly areas: AgentAreaRepository) {}

  /**
   * @param membrosDeDev membros da área DINÂMICA de dev (`dev-<modulo>`). Vazio
   * na criação do projeto, porque ainda não há `module_map`: a área nasce sem
   * membros enumerados e a REGRA de endereçamento continua valendo pelo
   * predicado `ehDevDeModulo`, que não consulta o banco.
   */
  async execute(projectId: string, membrosDeDev: readonly string[] = []) {
    const gravadas: AgentArea[] = [];

    for (const area of AGENT_AREAS) {
      gravadas.push(
        await this.areas.upsert({
          projectId,
          key: area.key,
          leadAgentId: area.lead,
          // `ehMembro` é o que distingue área dinâmica de área enumerável: quem
          // tem predicado não tem lista em código, e os membros vêm de fora.
          members: area.ehMembro ? [...membrosDeDev] : [...area.members],
        }),
      );
    }

    return gravadas;
  }
}
