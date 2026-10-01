import { Injectable } from '@nestjs/common';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { GetModuleContractsUseCase } from './get-module-contracts.use-case';
import type { ItemDeContrato } from '../../../domain/architecture/module-contracts';

export interface ContratoLidoDeModulo {
  modulo: string;
  /** Do `dependsOn` do module_map vigente — o que o módulo CONSOME. */
  dependeDe: string[];
  /** O que ele expõe, ou `null` quando o Arquiteto não declarou contrato. */
  expoe: ItemDeContrato[] | null;
}

export interface ContratosDoProjeto {
  status: 'sem_contratos' | 'declarados';
  /** Versão do artefato vigente — 0 quando não há contratos. */
  version: number;
  /** Um por módulo do module_map VIGENTE, na ordem do mapa. */
  modulos: ContratoLidoDeModulo[];
  /** Contratos de módulos que o mapa vigente não tem mais. */
  contratosForaDoMapa: string[];
}

/**
 * O que um dev agent lê para descobrir a interface de outro módulo sem abrir
 * o worktree dele (ADR 0200, RN-684). Leitura CONTIDA (ADR 0060): escopo
 * fechado no projeto pelo caminho da rota, sem parâmetro de busca, um item
 * por módulo do mapa.
 *
 * Compõe as duas fontes em vez de duplicar uma na outra: o que cada módulo
 * CONSOME vem do `dependsOn` do module_map vigente (já validado sem ciclo), e
 * o que ele EXPÕE vem do contrato vigente. Contrato de módulo que saiu do mapa
 * é DITO (`contratosForaDoMapa`), nunca somado a um módulo que não existe.
 */
@Injectable()
export class ListModuleContractsUseCase {
  constructor(
    private readonly moduleMaps: ModuleMapRepository,
    private readonly getModuleContracts: GetModuleContractsUseCase,
  ) {}

  async execute(projectId: string): Promise<ContratosDoProjeto> {
    const [moduleMap, estado] = await Promise.all([
      this.moduleMaps.findCurrent(projectId),
      this.getModuleContracts.execute(projectId),
    ]);

    const porModulo = new Map(estado.contratos.map((c) => [c.modulo, c.expoe]));
    const modulos = (moduleMap?.modules ?? []).map((m) => ({
      modulo: m.name,
      dependeDe: [...m.dependsOn],
      expoe: porModulo.get(m.name) ?? null,
    }));

    const noMapa = new Set(modulos.map((m) => m.modulo));
    const contratosForaDoMapa = estado.contratos
      .map((c) => c.modulo)
      .filter((nome) => !noMapa.has(nome));

    return {
      status: estado.status,
      version: estado.version,
      modulos,
      contratosForaDoMapa,
    };
  }
}
