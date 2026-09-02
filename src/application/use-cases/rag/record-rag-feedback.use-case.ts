import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { RagTelemetryRepository } from '../../ports/rag-telemetry-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import type { Actor } from '../../../domain/sessions/session-event.entity';
import type { RagVerdict } from '../../../domain/rag/rag-telemetry';

export interface RecordRagFeedbackInput {
  projectId: string;
  searchId: string;
  chunkId: string;
  verdict: RagVerdict;
  actor: Actor;
}

export interface RagFeedbackReport {
  searchId: string;
  chunkId: string;
  verdict: RagVerdict;
  /** O rank em que o trecho VOTADO apareceu naquela busca (1-based). */
  rank: number;
}

/**
 * O voto sobre um trecho recuperado (RN-480) — o único sinal de VERDADE da
 * medição do RAG. Latência e taxa de degradação dizem se a busca RODOU; só o
 * voto diz se ela ACERTOU.
 *
 * ## As duas recusas são 400, e as duas ensinam
 *
 * `searchId` desconhecido e `chunkId` que não estava naquela busca são erros
 * de REFERÊNCIA de quem chama, não estado do recurso. Vale para os dois
 * caminhos: pela aba vira 400, e pelo agente vira tool-result de erro que o
 * modelo pode corrigir na próxima iteração — RN-061/RN-163, nunca um crash.
 *
 * Votar num chunk que a busca não devolveu não é um detalhe de validação: o
 * `rank` do trecho votado é a métrica que separa "o índice está pobre" de "os
 * PESOS estão errados". Aceitar um voto sem rank produziria número sem
 * significado, que é pior que número nenhum.
 *
 * ## A busca votada pode ser de OUTRO projeto
 *
 * Por isso o `projectId` da rota é conferido contra o da busca. O `RolesGuard`
 * autoriza o chamador NAQUELE projeto; sem esta checagem, quem tem papel num
 * projeto poderia carimbar voto numa busca de outro.
 */
@Injectable()
export class RecordRagFeedbackUseCase {
  private readonly logger = new Logger(RecordRagFeedbackUseCase.name);

  constructor(
    private readonly telemetry: RagTelemetryRepository,
    private readonly eventos: AppendSessionEventUseCase,
  ) {}

  async execute(input: RecordRagFeedbackInput): Promise<RagFeedbackReport> {
    const busca = await this.telemetry.findSearchById(input.searchId);
    if (!busca || busca.projectId !== input.projectId) {
      throw new BadRequestException(
        `busca \`${input.searchId}\` não existe neste projeto — vote usando o \`searchId\` que a própria busca devolveu`,
      );
    }

    const hit = busca.hits.find((h) => h.chunkId === input.chunkId);
    if (!hit) {
      throw new BadRequestException(
        `o trecho \`${input.chunkId}\` não estava entre os ${busca.hits.length} resultado(s) da busca \`${input.searchId}\` — só se vota no que a busca devolveu`,
      );
    }

    await this.telemetry.recordFeedback({
      searchId: input.searchId,
      chunkId: input.chunkId,
      verdict: input.verdict,
      actorKind: input.actor.kind,
      actorId: input.actor.id,
    });

    // Narração, só quando há sessão — a mesma régua de `rag.search`. E, como
    // lá, falha de narração não derruba o voto: o voto já está gravado na
    // tabela, que é a fonte da medição.
    if (busca.sessionId) {
      try {
        await this.eventos.execute(input.projectId, busca.sessionId, {
          // Literal, nunca constante — ver o comentário em
          // `domain/rag/rag-telemetry.ts`: o inventário de eventos é gerado
          // por grep de `type: '<x>.<y>'` sobre o código da api.
          type: 'rag.feedback',
          actor: input.actor,
          payload: {
            searchId: input.searchId,
            chunkId: input.chunkId,
            verdict: input.verdict,
            rank: hit.rank,
          },
        });
      } catch (erro) {
        this.logger.error(
          `[origem: infra] narração \`rag.feedback\` não foi gravada na sessão ${busca.sessionId}: ${erro instanceof Error ? erro.message : String(erro)}`,
        );
      }
    }

    return {
      searchId: input.searchId,
      chunkId: input.chunkId,
      verdict: input.verdict,
      rank: hit.rank,
    };
  }
}
