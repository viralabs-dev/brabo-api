import { Injectable, NotFoundException } from '@nestjs/common';
import type { GitTree } from '@brabo/shared';
import { ReadProjectCodeUseCase } from '../git/read-project-code.use-case';
import {
  ChunkRepository,
  type ChunkScope,
  type NewChunk,
} from '../../ports/chunk-repository.port';
import { RagEmbeddingService } from './rag-embedding.service';
import { chunkMarkdownDocument } from '../../../domain/rag/chunking';
import {
  RAG_INDEX_DIR_LIMIT,
  RAG_INDEX_FILE_LIMIT,
} from '../../../domain/rag/rag-search-limits';

/** A raiz onde a indexação de `docs`/`adr` procura Markdown, no repositório do PRÓPRIO projeto. */
const DOCS_ROOT = 'docs';
const ADR_DIR_PREFIX = 'docs/adr/';

export interface IndexDocsReport {
  filesScanned: number;
  docsChunks: number;
  adrChunks: number;
  /** `true` quando o teto de diretórios/arquivos cortou a varredura antes de terminar. */
  truncated: boolean;
  embedding: {
    available: boolean;
    embedded: number;
    skipped: number;
    reason?: string;
  };
}

/**
 * Indexa `docs`/`adr` de UM projeto para o Chat RAG (PROGRAMA 28, Onda 4 —
 * RN-232/233, ADR 0080).
 *
 * ## De ONDE vem o texto
 *
 * Do repositório do PRÓPRIO projeto, via `ReadProjectCodeUseCase` — a mesma
 * superfície que a aba Code usa (mesma resolução de credencial do owner,
 * mesmo portão de container RN-105, mesma checagem de caminho RN-095, mesmo
 * cache). Não é a documentação do Brabo em si: é a convenção `docs/`/`docs/
 * adr/` que CADA projeto gerenciado pode ter no seu próprio repositório —
 * ela existe porque a maioria dos projetos que o Brabo provisiona segue a
 * MESMA convenção que este monorepo usa (a FASE DOC descreve isso), mas o
 * pipeline não assume nada sobre o conteúdo, só sobre o CAMINHO.
 *
 * ## Por que UM caso de uso cobre os DOIS escopos
 *
 * `docs` e `adr` compartilham a MESMA árvore (`docs/adr/` é uma subpasta de
 * `docs/`) — separar em dois casos de uso duplicaria a varredura da árvore
 * (uma chamada `listTree` a mais por diretório, sem necessidade) só para
 * escrever em dois lugares diferentes. A distinção de escopo é decidida por
 * PREFIXO de caminho, não por dois caminhos de entrada.
 *
 * ## Idempotência (RN-231)
 *
 * Full rebuild: apaga TODOS os chunks dos dois escopos antes de escrever os
 * novos. Não há coluna de hash/versão do arquivo fonte (decisão do ADR
 * 0079) — sem ela, a única forma honesta de "reindexar" é reconstruir do
 * zero a partir do estado atual dos arquivos.
 */
@Injectable()
export class IndexProjectDocsUseCase {
  constructor(
    private readonly readCode: ReadProjectCodeUseCase,
    private readonly chunks: ChunkRepository,
    private readonly embeddings: RagEmbeddingService,
  ) {}

  async execute(projectId: string): Promise<IndexDocsReport> {
    const { paths, truncated } = await this.listarArquivosMarkdown(projectId);

    interface Candidato {
      scope: ChunkScope;
      sourcePath: string;
      title?: string;
      headingPath: string[];
      content: string;
      chunkIndex: number;
      totalChunks: number;
    }
    const candidatos: Candidato[] = [];

    for (const caminho of paths) {
      const arquivo = await this.readCode.file(projectId, caminho);
      const scope: ChunkScope = caminho.startsWith(ADR_DIR_PREFIX)
        ? 'adr'
        : 'docs';
      const titulo = extrairTitulo(arquivo.content);
      const pedacos = chunkMarkdownDocument(arquivo.content);
      pedacos.forEach((pedaco, i) => {
        candidatos.push({
          scope,
          sourcePath: caminho,
          title: titulo,
          headingPath: pedaco.headingPath,
          content: pedaco.content,
          chunkIndex: i,
          totalChunks: pedacos.length,
        });
      });
    }

    // Idempotente (RN-231): apaga os dois escopos ANTES de escrever — se a
    // varredura não achou nada (projeto sem docs/), os dois ficam vazios, o
    // que é honesto: não há o que citar.
    await this.chunks.deleteByScope(projectId, 'docs');
    await this.chunks.deleteByScope(projectId, 'adr');

    const { vectors, available, reason } = await this.embeddings.embedMany(
      candidatos.map((c) => c.content),
    );

    const novos: NewChunk[] = candidatos.map((c, i) => ({
      projectId,
      scope: c.scope,
      sourcePath: c.sourcePath,
      content: c.content,
      embedding: vectors[i] ?? null,
      metadata: {
        title: c.title,
        headingPath: c.headingPath.length > 0 ? c.headingPath : undefined,
        chunkIndex: c.chunkIndex,
        totalChunks: c.totalChunks,
      },
    }));

    if (novos.length > 0) await this.chunks.createMany(novos);

    const embedded = vectors.filter((v) => v !== null).length;
    return {
      filesScanned: paths.length,
      docsChunks: novos.filter((c) => c.scope === 'docs').length,
      adrChunks: novos.filter((c) => c.scope === 'adr').length,
      truncated,
      embedding: {
        available,
        embedded,
        skipped: novos.length - embedded,
        reason,
      },
    };
  }

  /**
   * A varredura em LARGURA da árvore `docs/`, igual em espírito a
   * `ReadProjectCodeUseCase.search` — largura para que um corte no meio
   * entregue os arquivos mais rasos primeiro, não um ramo arbitrário
   * inteiro. Exposto (não privado) porque `GetRagCoverageUseCase` reusa a
   * mesma contagem para responder "quantos arquivos existem" sem duplicar a
   * varredura.
   */
  async listarArquivosMarkdown(
    projectId: string,
  ): Promise<{ paths: string[]; truncated: boolean }> {
    const paths: string[] = [];
    const fila: string[] = [DOCS_ROOT];
    let diretorios = 0;
    let truncated = false;

    while (fila.length > 0) {
      if (diretorios >= RAG_INDEX_DIR_LIMIT) {
        truncated = true;
        break;
      }
      const diretorio = fila.shift()!;
      diretorios++;

      let arvore: GitTree;
      try {
        arvore = await this.readCode.tree(projectId, undefined, diretorio);
      } catch (erro) {
        // Projeto sem pasta `docs/` — nada a indexar, não é falha.
        if (erro instanceof NotFoundException) continue;
        throw erro;
      }
      if (arvore.truncated) truncated = true;

      for (const entrada of arvore.entries) {
        if (entrada.type === 'dir') {
          fila.push(entrada.path);
          continue;
        }
        if (!entrada.path.toLowerCase().endsWith('.md')) continue;
        if (paths.length >= RAG_INDEX_FILE_LIMIT) {
          truncated = true;
          continue;
        }
        paths.push(entrada.path);
      }
    }
    return { paths, truncated };
  }
}

function extrairTitulo(markdown: string): string | undefined {
  const casamento = /^#\s+(.+)$/m.exec(markdown);
  return casamento ? casamento[1].trim() : undefined;
}
