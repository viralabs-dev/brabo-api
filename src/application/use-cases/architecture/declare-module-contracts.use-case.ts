import { BadRequestException, Injectable } from '@nestjs/common';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { GetModuleContractsUseCase } from './get-module-contracts.use-case';
import { missingModules } from '../../../domain/architecture/module-resolution';
import {
  ContratoInvalidoError,
  EVENTO_MODULE_CONTRACTS,
  validarContratos,
  type ContratoDeModulo,
  type ContratoDeModuloInput,
} from '../../../domain/architecture/module-contracts';

export interface DeclareModuleContractsInput {
  contratos: ContratoDeModuloInput[];
}

export interface ContratosDeclarados {
  contratos: ContratoDeModulo[];
  version: number;
}

/**
 * Declara o contrato entre módulos — tool `declare_module_contracts` do
 * Arquiteto (ADR 0200, RN-684).
 *
 * ## Sem tabela, versionado, o vigente substitui
 *
 * O artefato É o evento `artifact.module_contracts`, ao lado de
 * `artifact.module_map`/`artifact.module_routing`/`artifact.c4_diagram`.
 * Mudar um contrato é emitir a lista INTEIRA de novo, numa versão nova — a
 * anterior continua no log. É declaração de arquitetura, sem efeito externo,
 * e por isso não passa por `proposed_action`.
 *
 * ## Artefato PRÓPRIO, e não campo do `module_map`
 *
 * O `module_map` é lido pela execução inteira (claim de task, roteamento,
 * C4) e revisá-lo reabre a validação de ciclo. O contrato muda noutro ritmo —
 * a interface se descobre enquanto os devs trabalham —, e revisar um não
 * pode reemitir o outro nem disputar o schema dele com outra frente.
 *
 * ## Exige module_map vigente
 *
 * Cada `modulo` precisa ser um nome do mapa vigente, e a recusa lista os
 * VÁLIDOS — mesmo motivo de `RouteModulesToInfraUseCase`.
 */
@Injectable()
export class DeclareModuleContractsUseCase {
  constructor(
    private readonly moduleMaps: ModuleMapRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly getModuleContracts: GetModuleContractsUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    input: DeclareModuleContractsInput,
    declaradoPor = 'arquiteto',
  ): Promise<ContratosDeclarados> {
    let contratos: ContratoDeModulo[];
    try {
      contratos = validarContratos(input.contratos);
    } catch (e) {
      if (e instanceof ContratoInvalidoError) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }

    const moduleMap = await this.moduleMaps.findCurrent(projectId);
    if (!moduleMap) {
      throw new BadRequestException(
        'Defina o module_map (create_module_map) antes de declarar ' +
          'contratos — não há módulo nenhum sem ele.',
      );
    }

    const names = moduleMap.modules.map((m) => m.name);
    const missing = missingModules(
      contratos.map((c) => c.modulo),
      names,
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        `Módulos inexistentes no module_map vigente: ${missing.join(', ')}. ` +
          `Os módulos válidos são: ${names.join(', ')}.`,
      );
    }

    const atual = await this.getModuleContracts.execute(projectId);
    const version = atual.version + 1;

    await this.appendEvent.execute(projectId, sessionId, {
      type: EVENTO_MODULE_CONTRACTS,
      actor: { kind: 'agent', id: declaradoPor },
      payload: { contratos, version },
    });

    return { contratos, version };
  }
}
