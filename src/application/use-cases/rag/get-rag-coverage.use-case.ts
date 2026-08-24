import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { ChunkRepository } from '../../ports/chunk-repository.port';
import { IndexProjectDocsUseCase } from './index-project-docs.use-case';

const ADR_DIR_PREFIX = 'docs/adr/';

export interface RagFileCoverage {
  /** Arquivos `.md` encontrados no repositório AGORA, para este escopo. */
  filesInRepo: number;
  /** Desses, quantos têm ao menos um chunk indexado. */
  filesIndexed: number;
  /** A varredura do repositório foi cortada por teto — a contagem de `filesInRepo` é um PISO, não o total real. */
  truncated: boolean;
}

export interface RagSessionCoverage {
  sessionsInProject: number;
  sessionsIndexed: number;
}

/**
 * Cobertura do escopo `local` (RN-455, ADR 0113) — não há "total real" para
 * comparar (a pasta só existe no navegador de quem anexou, o servidor nunca
 * a viu antes do upload), então esta forma é DIFERENTE de `RagFileCoverage`:
 * conta o que está indexado AGORA, nunca um "de quantos". `lastAttachedAt` é
 * `MAX(chunks.createdAt)` do escopo — um valor REAL, nunca um "há Xmin"
 * chutado (mesma disciplina da RN-237 para os outros escopos).
 */
export interface RagLocalCoverage {
  filesIndexed: number;
  folderName: string | null;
  lastAttachedAt: string | null;
}

export interface RagCoverage {
  docs: RagFileCoverage;
  adr: RagFileCoverage;
  session: RagSessionCoverage;
  local: RagLocalCoverage;
  chunksTotal: number;
  /** Chunks gravados sem vetor — a lacuna que RN-233 declara em vez de esconder. */
  chunksWithoutVector: number;
}

/**
 * "Cobertura do índice" (handoff, painel do Chat RAG — "X% indexado, Y
 * arquivos fora") — PROGRAMA 28, Onda 4, item 5 (RN-234, ADR 0080).
 *
 * Responde com o que dá para responder HONESTAMENTE hoje: contagem real de
 * arquivos `.md` no repositório contra quantos têm chunk (`docs`/`adr`), e
 * sessões do projeto contra quantas têm chunk (`session`). Não inventa uma
 * "última vez que reindexou" nem "há N minutos" — não existe coluna de
 * timestamp de indexação por escopo, e um "12min" chutado seria pior que
 * nenhum número (mesma classe de erro que o ADR 0042 recusa para nota de
 * modelo). A UI (Onda 5) decide como apresentar `filesInRepo`/`filesIndexed`
 * como barra e percentual — este caso de uso só garante que os dois números
 * são reais.
 */
@Injectable()
export class GetRagCoverageUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly sessions: SessionRepository,
    private readonly chunks: ChunkRepository,
    private readonly indexDocs: IndexProjectDocsUseCase,
  ) {}

  async execute(projectId: string): Promise<RagCoverage> {
    const project = await this.projects.findById(projectId);
    if (!project)
      throw new NotFoundException(`Projeto não encontrado: ${projectId}`);

    const [todosOsChunks, arquivos, sessoes] = await Promise.all([
      this.chunks.listByProject(projectId),
      this.indexDocs.listarArquivosMarkdown(projectId),
      this.sessions.listForProject(projectId),
    ]);

    const arquivosDocs = arquivos.paths.filter(
      (p) => !p.startsWith(ADR_DIR_PREFIX),
    );
    const arquivosAdr = arquivos.paths.filter((p) =>
      p.startsWith(ADR_DIR_PREFIX),
    );

    const docsIndexados = new Set(
      todosOsChunks.filter((c) => c.scope === 'docs').map((c) => c.sourcePath),
    );
    const adrIndexados = new Set(
      todosOsChunks.filter((c) => c.scope === 'adr').map((c) => c.sourcePath),
    );
    const sessoesIndexadas = new Set(
      todosOsChunks
        .filter((c) => c.scope === 'session')
        .map((c) => c.sessionId),
    );

    const chunksLocal = todosOsChunks.filter((c) => c.scope === 'local');
    const arquivosLocalIndexados = new Set(
      chunksLocal.map((c) => c.sourcePath),
    );
    const ultimoChunkLocal = chunksLocal.reduce<Date | null>(
      (mais_recente, c) =>
        !mais_recente || c.createdAt > mais_recente
          ? c.createdAt
          : mais_recente,
      null,
    );

    return {
      docs: {
        filesInRepo: arquivosDocs.length,
        filesIndexed: arquivosDocs.filter((p) => docsIndexados.has(p)).length,
        truncated: arquivos.truncated,
      },
      adr: {
        filesInRepo: arquivosAdr.length,
        filesIndexed: arquivosAdr.filter((p) => adrIndexados.has(p)).length,
        truncated: arquivos.truncated,
      },
      session: {
        sessionsInProject: sessoes.length,
        sessionsIndexed: [...sessoesIndexadas].filter((id) =>
          sessoes.some((s) => s.id === id),
        ).length,
      },
      local: {
        filesIndexed: arquivosLocalIndexados.size,
        folderName: chunksLocal[0]?.metadata.folderName ?? null,
        lastAttachedAt: ultimoChunkLocal
          ? ultimoChunkLocal.toISOString()
          : null,
      },
      chunksTotal: todosOsChunks.length,
      chunksWithoutVector: todosOsChunks.filter((c) => c.embedding === null)
        .length,
    };
  }
}
