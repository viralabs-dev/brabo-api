import { Injectable, NotFoundException } from '@nestjs/common';
import { SessionRepository } from '../../ports/session-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { ChunkRepository, type NewChunk } from '../../ports/chunk-repository.port';
import { RagEmbeddingService } from './rag-embedding.service';
import { chunkText } from '../../../domain/rag/chunking';

export interface IndexSessionReport {
  eventsScanned: number;
  chunksCreated: number;
  embedding: {
    available: boolean;
    embedded: number;
    skipped: number;
    reason?: string;
  };
}

/**
 * O que conta como texto de UMA sessão, para o escopo `session` do índice
 * (RN-232). `chat.message` (o humano) e `agent.response` (o agente) são as
 * DUAS metades de uma conversa — o resto do event log (`tool.call`,
 * `agent.status`, eventos de gate, etc.) é mecanismo/ruído de máquina, não
 * conhecimento citável: indexar um `tool.call` faria a busca devolver um
 * payload JSON como se fosse prosa. Um `agent.error` também fica de fora —
 * ele é sobre a FALHA, não sobre o assunto da sessão, e citá-lo como
 * "conhecimento" confundiria as duas coisas.
 */
const TIPOS_INDEXAVEIS = ['chat.message', 'agent.response'] as const;

/**
 * Indexa UMA sessão para o Chat RAG (PROGRAMA 28, Onda 4 — RN-232/233, ADR
 * 0080).
 *
 * Cada evento indexável vira um ou mais chunks (via `chunkText`, quando a
 * mensagem passa do alvo); `metadata.sourceRef` guarda o id do evento de
 * ORIGEM — o mesmo id que `GetSessionEventUseCase` resolve — para a citação
 * poder navegar de volta ao ponto exato da conversa, não só "esta sessão em
 * algum lugar".
 *
 * Idempotente (RN-231): apaga todos os chunks DESTA sessão antes de
 * escrever os novos — reindexar a mesma sessão duas vezes não duplica.
 */
@Injectable()
export class IndexSessionUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly sessionEvents: SessionEventRepository,
    private readonly chunks: ChunkRepository,
    private readonly embeddings: RagEmbeddingService,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
  ): Promise<IndexSessionReport> {
    const session = await this.sessions.findInProject(projectId, sessionId);
    if (!session) throw new NotFoundException('Sessão não encontrada');

    const eventosPorTipo = await Promise.all(
      TIPOS_INDEXAVEIS.map((tipo) =>
        this.sessionEvents.listByTypeInSession(sessionId, tipo),
      ),
    );
    const eventos = eventosPorTipo.flat().sort((a, b) => a.seq - b.seq);

    interface Candidato {
      content: string;
      chunkIndex: number;
      totalChunks: number;
      sourceRef: string;
      autor: string;
    }
    const candidatos: Candidato[] = [];

    for (const evento of eventos) {
      const texto = extrairTexto(evento.payload);
      if (!texto?.trim()) continue;
      const pedacos = chunkText(texto);
      pedacos.forEach((pedaco, i) => {
        candidatos.push({
          content: pedaco.content,
          chunkIndex: i,
          totalChunks: pedacos.length,
          sourceRef: evento.id,
          autor: `${evento.actor.kind}:${evento.actor.id}`,
        });
      });
    }

    await this.chunks.deleteBySession(sessionId);

    const { vectors, available, reason } = await this.embeddings.embedMany(
      candidatos.map((c) => c.content),
    );

    const novos: NewChunk[] = candidatos.map((c, i) => ({
      projectId,
      scope: 'session',
      sessionId,
      content: c.content,
      embedding: vectors[i] ?? null,
      metadata: {
        title: c.autor,
        chunkIndex: c.chunkIndex,
        totalChunks: c.totalChunks,
        sourceRef: c.sourceRef,
      },
    }));

    if (novos.length > 0) await this.chunks.createMany(novos);

    const embedded = vectors.filter((v) => v !== null).length;
    return {
      eventsScanned: eventos.length,
      chunksCreated: novos.length,
      embedding: {
        available,
        embedded,
        skipped: novos.length - embedded,
        reason,
      },
    };
  }
}

function extrairTexto(payload: unknown): string | null {
  if (
    payload &&
    typeof payload === 'object' &&
    'text' in payload &&
    typeof (payload as { text?: unknown }).text === 'string'
  ) {
    return (payload as { text: string }).text;
  }
  return null;
}
