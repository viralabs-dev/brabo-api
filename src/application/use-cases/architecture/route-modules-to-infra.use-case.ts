import { BadRequestException, Injectable } from '@nestjs/common';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { GetModuleRoutingUseCase } from './get-module-routing.use-case';
import { missingModules } from '../../../domain/architecture/module-resolution';
import {
  EVENTO_MODULE_ROUTING,
  RoteamentoInvalidoError,
  validarRoteamento,
  type RoteamentoDeModulo,
  type RoteamentoDeModuloInput,
} from '../../../domain/architecture/module-routing';

export interface RouteModulesToInfraInput {
  roteamento: RoteamentoDeModuloInput[];
}

export interface RoteamentoDeModulosGerado {
  roteamento: RoteamentoDeModulo[];
  version: number;
}

/**
 * Roteia cada módulo do `module_map` vigente para uma imagem candidata — tool
 * `route_modules_to_infra` do Arquiteto.
 *
 * ## `:direct`, e o mesmo argumento de `project_image`/`c4_diagram` (ADR 0131)
 *
 * O artefato É o evento `artifact.module_routing`: imutável, versionado e com
 * autor, ao lado de `artifact.module_map`/`artifact.project_image`/
 * `artifact.c4_diagram`. Roteamento é decisão de arquitetura do Arquiteto —
 * não tem efeito externo (não sobe container, não muda nada fora do event
 * log) e por isso não passa por `proposed_action`.
 *
 * ## Arquiteto candidata, Infra elege
 *
 * A imagem de cada item é a CANDIDATA do Arquiteto, não a decisão final: quem
 * elege entre as candidatas (ou recusa todas) é o Infra Lead, num PR à parte.
 * Este caso de uso só garante que a candidatura é bem formada: módulo
 * existente no mapa vigente, imagem com tag/digest explícito, `rationale`
 * real.
 *
 * ## Exige module_map vigente — não há módulo sem module_map
 *
 * Sem mapa, não há o que rotear: a recusa nomeia a ausência em vez de deixar
 * o modelo adivinhar (mesmo texto de `assign_story_modules` quando não há
 * mapa). Com mapa, cada `modulo` da lista precisa ser um nome que o mapa
 * conhece — a recusa lista os nomes VÁLIDOS, pelo mesmo motivo de
 * `AssignStoryModulesUseCase`: adivinhar em cima de "módulo inexistente" sem
 * saber quais existem é a busca cega que motivou aquela correção.
 */
@Injectable()
export class RouteModulesToInfraUseCase {
  constructor(
    private readonly moduleMaps: ModuleMapRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly getModuleRouting: GetModuleRoutingUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    input: RouteModulesToInfraInput,
    roteadoPor = 'arquiteto',
  ): Promise<RoteamentoDeModulosGerado> {
    let roteamento: RoteamentoDeModulo[];
    try {
      roteamento = validarRoteamento(input.roteamento);
    } catch (e) {
      if (e instanceof RoteamentoInvalidoError) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }

    const moduleMap = await this.moduleMaps.findCurrent(projectId);
    if (!moduleMap) {
      throw new BadRequestException(
        'Defina o module_map (create_module_map) antes de rotear módulos ' +
          'para infra — não há módulo nenhum sem ele.',
      );
    }

    const names = moduleMap.modules.map((m) => m.name);
    const missing = missingModules(
      roteamento.map((r) => r.modulo),
      names,
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        `Módulos inexistentes no module_map vigente: ${missing.join(', ')}. ` +
          `Os módulos válidos são: ${names.join(', ')}.`,
      );
    }

    const atual = await this.getModuleRouting.execute(projectId);
    const version = atual.version + 1;

    await this.appendEvent.execute(projectId, sessionId, {
      type: EVENTO_MODULE_ROUTING,
      actor: { kind: 'agent', id: roteadoPor },
      payload: { roteamento, version },
    });

    return { roteamento, version };
  }
}
