import { Injectable } from '@nestjs/common';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import {
  EVENTO_INSTRUCOES_DE_EXECUCAO,
  recusaDoRun,
  type InstrucoesDeExecucao,
} from '../../../domain/infra/run-instructions';

export interface InstrucoesVigentes extends InstrucoesDeExecucao {
  version: number;
  eventId: string;
  declaredAt: string;
}

/**
 * O `artifact.run_instructions` vigente do projeto (RN-852): o de maior
 * `version`, desempate por `seq` — a mesma redução de
 * `ObterContainerDoProjetoUseCase`. `null` quando a Infra ainda não abriu PR
 * com `run`. Payload que não valida mais é ignorado (não se mostra comando
 * ilegível como se fosse instrução).
 */
@Injectable()
export class GetRunInstructionsUseCase {
  constructor(private readonly eventos: SessionEventRepository) {}

  async execute(projectId: string): Promise<InstrucoesVigentes | null> {
    const eventos = await this.eventos.listByTypeForProject(
      projectId,
      EVENTO_INSTRUCOES_DE_EXECUCAO,
    );
    let vigente: (typeof eventos)[number] | null = null;
    for (const e of eventos) {
      if (!vigente || maisNovo(e, vigente)) vigente = e;
    }
    if (!vigente) return null;
    const p = (vigente.payload ?? {}) as Record<string, unknown>;
    if (recusaDoRun(p) !== null) return null;
    return {
      command: p.command as string,
      urls: p.urls as InstrucoesDeExecucao['urls'],
      envExample: p.envExample as boolean,
      ...(p.app ? { app: p.app as InstrucoesDeExecucao['app'] } : {}),
      ...(p.qa ? { qa: p.qa as InstrucoesDeExecucao['qa'] } : {}),
      prUrl: typeof p.prUrl === 'string' ? p.prUrl : '',
      version: versao(p),
      eventId: vigente.id,
      declaredAt: vigente.createdAt.toISOString(),
    };
  }

  /** A próxima versão a emitir. */
  async proximaVersao(projectId: string): Promise<number> {
    const eventos = await this.eventos.listByTypeForProject(
      projectId,
      EVENTO_INSTRUCOES_DE_EXECUCAO,
    );
    return eventos.reduce((m, e) => Math.max(m, versao(e.payload)), 0) + 1;
  }
}

function versao(payload: unknown): number {
  const v = (payload as { version?: unknown } | null)?.version;
  return typeof v === 'number' && Number.isInteger(v) ? v : 0;
}

function maisNovo(
  a: { payload: unknown; seq: number },
  b: { payload: unknown; seq: number },
): boolean {
  const va = versao(a.payload);
  const vb = versao(b.payload);
  return va !== vb ? va > vb : a.seq > b.seq;
}
