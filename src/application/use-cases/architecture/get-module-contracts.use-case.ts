import { Injectable } from '@nestjs/common';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import {
  EVENTO_MODULE_CONTRACTS,
  SEM_CONTRATOS,
  TIPOS_DE_ITEM_DE_CONTRATO,
  type ContratoDeModulo,
  type EstadoDosContratos,
  type ItemDeContrato,
  type TipoDeItemDeContrato,
} from '../../../domain/architecture/module-contracts';

/**
 * Os contratos entre módulos vigentes de um projeto — leitura, sem tabela
 * (mesmo desenho de `GetModuleRoutingUseCase`/`GetC4DiagramUseCase`): o
 * artefato É o evento `artifact.module_contracts`, e o vigente é o de maior
 * `version`, com desempate por `seq` (ADR 0200, RN-684).
 */
@Injectable()
export class GetModuleContractsUseCase {
  constructor(private readonly eventos: SessionEventRepository) {}

  async execute(projectId: string): Promise<EstadoDosContratos> {
    const eventos = await this.eventos.listByTypeForProject(
      projectId,
      EVENTO_MODULE_CONTRACTS,
    );
    if (eventos.length === 0) return SEM_CONTRATOS;

    const vigente = eventos.reduce((maior, e) =>
      maisNovo(e, maior) ? e : maior,
    );
    const payload = (vigente.payload ?? {}) as Record<string, unknown>;

    return {
      status: 'declarados',
      contratos: extrairContratos(payload),
      version: versao(payload),
      eventId: vigente.id,
      createdAt: vigente.createdAt.toISOString(),
    };
  }
}

// Payload de outra época pode ter outra forma — degrada para lista vazia em
// vez de derrubar a leitura, mesma régua de `GetModuleRoutingUseCase`.
function extrairContratos(
  payload: Record<string, unknown>,
): ContratoDeModulo[] {
  const valor = payload.contratos;
  if (!Array.isArray(valor)) return [];
  return valor.filter(ehObjeto).map((c) => ({
    modulo: texto(c.modulo),
    expoe: Array.isArray(c.expoe)
      ? c.expoe.filter(ehObjeto).map((i): ItemDeContrato => ({
          tipo: tipoDeItem(i.tipo),
          assinatura: texto(i.assinatura),
          descricao: texto(i.descricao),
        }))
      : [],
  }));
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

function tipoDeItem(valor: unknown): TipoDeItemDeContrato {
  return TIPOS_DE_ITEM_DE_CONTRATO.includes(valor as TipoDeItemDeContrato)
    ? (valor as TipoDeItemDeContrato)
    : 'funcao';
}

function versao(payload: unknown): number {
  const v = (payload as { version?: unknown } | null)?.version;
  return typeof v === 'number' && Number.isFinite(v) ? v : 1;
}

/** Por (version, seq), nessa ordem — mesmo motivo de `GetC4DiagramUseCase`. */
function maisNovo(
  candidato: { payload: unknown; seq: number },
  atual: { payload: unknown; seq: number },
): boolean {
  const va = versao(candidato.payload);
  const vb = versao(atual.payload);
  if (va !== vb) return va > vb;
  return candidato.seq > atual.seq;
}
