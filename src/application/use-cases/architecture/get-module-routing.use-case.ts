import { Injectable } from '@nestjs/common';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import {
  EVENTO_MODULE_ROUTING,
  SEM_ROTEAMENTO,
  type EstadoDoRoteamento,
  type RoteamentoDeModulo,
} from '../../../domain/architecture/module-routing';

/**
 * O estado do roteamento de módulos vigente de um projeto — leitura, sem
 * tabela (mesmo desenho de `GetC4DiagramUseCase`/`ObterContainerDoProjetoUseCase`):
 * o artefato É o evento `artifact.module_routing`, e o vigente é o de maior
 * `version`, com desempate por `seq`.
 */
@Injectable()
export class GetModuleRoutingUseCase {
  constructor(private readonly eventos: SessionEventRepository) {}

  async execute(projectId: string): Promise<EstadoDoRoteamento> {
    const eventos = await this.eventos.listByTypeForProject(
      projectId,
      EVENTO_MODULE_ROUTING,
    );
    if (eventos.length === 0) return SEM_ROTEAMENTO;

    const vigente = eventos.reduce((maior, e) =>
      maisNovo(e, maior) ? e : maior,
    );
    const payload = (vigente.payload ?? {}) as Record<string, unknown>;

    return {
      status: 'roteado',
      roteamento: extrairRoteamento(payload),
      version: versao(payload),
      eventId: vigente.id,
      createdAt: vigente.createdAt.toISOString(),
    };
  }
}

function extrairRoteamento(
  payload: Record<string, unknown>,
): RoteamentoDeModulo[] {
  const valor = payload.roteamento;
  if (!Array.isArray(valor)) return [];
  return valor
    .filter(
      (r): r is Record<string, unknown> => typeof r === 'object' && r !== null,
    )
    .map((r) => ({
      modulo: texto(r.modulo),
      imagemCandidata: texto(r.imagemCandidata),
      porque: texto(r.porque),
    }));
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

function versao(payload: unknown): number {
  const v = (payload as { version?: unknown } | null)?.version;
  return typeof v === 'number' && Number.isFinite(v) ? v : 1;
}

/**
 * Compara por (version, seq), nessa ordem — mesmo motivo de
 * `GetC4DiagramUseCase`: combinar os dois numa conta inverteria a ordem
 * assim que uma sessão passasse do fator, e sessão longa é o caso normal.
 */
function maisNovo(
  candidato: { payload: unknown; seq: number },
  atual: { payload: unknown; seq: number },
): boolean {
  const va = versao(candidato.payload);
  const vb = versao(atual.payload);
  if (va !== vb) return va > vb;
  return candidato.seq > atual.seq;
}
