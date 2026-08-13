import { Injectable } from '@nestjs/common';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import {
  EVENTO_C4_DIAGRAM,
  SEM_DIAGRAMA,
  TIPOS_DE_ATOR_C4,
  type C4Ator,
  type C4Diagrama,
  type EstadoDoC4Diagrama,
  type TipoDeAtorC4,
} from '../../../domain/architecture/c4-diagram';

/**
 * O estado do diagrama C4 vigente de um projeto — leitura, sem tabela
 * (mesmo desenho de `ObterContainerDoProjetoUseCase`, ADR 0065): o artefato
 * É o evento `artifact.c4_diagram`, e o vigente é o de maior `version`, com
 * desempate por `seq`.
 */
@Injectable()
export class GetC4DiagramUseCase {
  constructor(private readonly eventos: SessionEventRepository) {}

  async execute(projectId: string): Promise<EstadoDoC4Diagrama> {
    const eventos = await this.eventos.listByTypeForProject(
      projectId,
      EVENTO_C4_DIAGRAM,
    );
    if (eventos.length === 0) return SEM_DIAGRAMA;

    const vigente = eventos.reduce((maior, e) =>
      maisNovo(e, maior) ? e : maior,
    );
    const payload = (vigente.payload ?? {}) as Record<string, unknown>;

    return {
      status: 'gerado',
      diagrama: extrairDiagrama(payload),
      version: versao(payload),
      eventId: vigente.id,
      createdAt: vigente.createdAt.toISOString(),
    };
  }
}

function extrairDiagrama(payload: Record<string, unknown>): C4Diagrama {
  return {
    systemName: texto(payload.systemName),
    systemDescription: texto(payload.systemDescription),
    actors: atores(payload.actors),
    contextDiagram: texto(payload.contextDiagram),
    containerDiagram: texto(payload.containerDiagram),
  };
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

// Payload de outra época pode ter uma forma diferente — degrada para lista
// vazia em vez de derrubar a leitura, mesma régua de
// `ObterContainerDoProjetoUseCase` para o `payload ilegível`.
function atores(valor: unknown): C4Ator[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .filter(
      (a): a is Record<string, unknown> => typeof a === 'object' && a !== null,
    )
    .map((a) => ({
      name: texto(a.name),
      type: tipoDeAtor(a.type),
      description: texto(a.description),
    }));
}

function tipoDeAtor(valor: unknown): TipoDeAtorC4 {
  return TIPOS_DE_ATOR_C4.includes(valor as TipoDeAtorC4)
    ? (valor as TipoDeAtorC4)
    : 'person';
}

function versao(payload: unknown): number {
  const v = (payload as { version?: unknown } | null)?.version;
  return typeof v === 'number' && Number.isFinite(v) ? v : 1;
}

/**
 * Compara por (version, seq), nessa ordem — mesmo motivo de
 * `ObterContainerDoProjetoUseCase`: combinar os dois numa conta inverteria a
 * ordem assim que uma sessão passasse do fator, e sessão longa é o caso
 * normal.
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
