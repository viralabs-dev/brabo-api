import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ChunkRepository,
  type NewChunk,
} from '../../ports/chunk-repository.port';
import { RagEmbeddingService } from './rag-embedding.service';
import { chunkMarkdownDocument, chunkText } from '../../../domain/rag/chunking';
import {
  RAG_LOCAL_ALLOWED_EXTENSIONS,
  RAG_LOCAL_FILE_BYTES_LIMIT,
  RAG_LOCAL_FILE_COUNT_LIMIT,
  RAG_LOCAL_TOTAL_BYTES_LIMIT,
} from '../../../domain/rag/rag-search-limits';

const EXTENSOES_MARKDOWN = new Set(['.md', '.mdx']);

export interface LocalFolderFile {
  /** Caminho RELATIVO dentro da pasta escolhida — nunca absoluto, nunca `..`. */
  path: string;
  content: string;
}

export interface IndexLocalFolderReport {
  folderName: string;
  filesIndexed: number;
  filesSkipped: number;
  chunksCreated: number;
  embedding: {
    available: boolean;
    embedded: number;
    skipped: number;
    reason?: string;
  };
}

/**
 * Indexa uma pasta LOCAL anexada pelo navegador para o Chat RAG (RN-455,
 * ADR 0113) — o quarto escopo honesto do índice, ao lado de `docs`/`adr`/
 * `session`.
 *
 * ## De ONDE vem o texto
 *
 * Do PRÓPRIO navegador de quem chama: `RagController` recebe uma lista de
 * `{ path, content }` já lida pelo `<input webkitdirectory>` do cliente
 * (ver `AttachLocalFolderModal.tsx`). Nenhum caminho de HOST atravessa a
 * rede — diferente do runner (ADR 0103/0107), que resolve um caminho real
 * de máquina, este caso de uso nunca vê um filesystem, só bytes que o
 * navegador já tinha o direito de ler (mesmo modelo de confiança de
 * qualquer upload de arquivo comum). Ver ADR 0113 para a distinção
 * completa com o que os ADR 0072/0107 recusaram.
 *
 * ## Rejeitar, nunca truncar em silêncio
 *
 * Este é um gesto ÚNICO do usuário, com um seletor de pasta na tela — não
 * uma varredura em background como `IndexProjectDocsUseCase`. Por isso os
 * DOIS tetos agregados (quantidade de arquivos, bytes somados) REJEITAM
 * (400) o upload inteiro em vez de indexar uma fatia e fingir que indexou
 * tudo: quem clicou "Anexar" está olhando a tela e pode escolher uma pasta
 * menor. Arquivo individual grande demais ou de extensão não reconhecida é
 * só PULADO (contado em `filesSkipped`) — não derruba o lote inteiro por um
 * arquivo binário perdido no meio.
 *
 * ## Caminho nunca confiável, mesmo vindo do navegador
 *
 * `webkitRelativePath` é gerado pelo próprio browser a partir do
 * filesystem real do usuário, então NÃO deveria conter `..` nem começar
 * com `/` — mas "não deveria" não é "não pode": um caminho assim é
 * rejeitado (400), nunca silenciosamente aceito, pela mesma disciplina de
 * nunca confiar em caminho vindo do cliente (RN-092/095).
 *
 * ## Idempotência (RN-231, mesmo padrão de `docs`/`adr`)
 *
 * Full rebuild: cada chamada apaga TODOS os chunks de `scope: 'local'` do
 * projeto antes de escrever os novos. **É esta chamada que resincroniza** —
 * não há reindexação automática nem watcher; o próprio upload de novo É o
 * mecanismo de atualizar (ver o comentário em `ReindexProjectUseCase` sobre
 * por que `local` não entra no "Reindexar agora").
 */
@Injectable()
export class IndexLocalFolderUseCase {
  constructor(
    private readonly chunks: ChunkRepository,
    private readonly embeddings: RagEmbeddingService,
  ) {}

  async execute(
    projectId: string,
    actorId: string,
    folderName: string,
    files: LocalFolderFile[],
  ): Promise<IndexLocalFolderReport> {
    if (files.length > RAG_LOCAL_FILE_COUNT_LIMIT) {
      throw new BadRequestException(
        `A pasta tem ${files.length} arquivo(s) — o teto é ${RAG_LOCAL_FILE_COUNT_LIMIT}. Escolha uma pasta menor.`,
      );
    }

    let totalBytes = 0;
    for (const arquivo of files) {
      if (arquivo.path.includes('..') || arquivo.path.startsWith('/')) {
        throw new BadRequestException(
          `Caminho de arquivo inválido: "${arquivo.path}".`,
        );
      }
      totalBytes += Buffer.byteLength(arquivo.content, 'utf8');
    }
    if (totalBytes > RAG_LOCAL_TOTAL_BYTES_LIMIT) {
      throw new BadRequestException(
        `O upload soma ${totalBytes} bytes — o teto é ${RAG_LOCAL_TOTAL_BYTES_LIMIT}. Escolha uma pasta menor.`,
      );
    }

    interface Candidato {
      sourcePath: string;
      content: string;
      chunkIndex: number;
      totalChunks: number;
    }
    const candidatos: Candidato[] = [];
    let filesSkipped = 0;
    const arquivosIndexados = new Set<string>();

    for (const arquivo of files) {
      const bytes = Buffer.byteLength(arquivo.content, 'utf8');
      const extensao = extensaoDoArquivo(arquivo.path);
      const extensaoAceita = (
        RAG_LOCAL_ALLOWED_EXTENSIONS as readonly string[]
      ).includes(extensao);

      if (bytes > RAG_LOCAL_FILE_BYTES_LIMIT || !extensaoAceita) {
        filesSkipped++;
        continue;
      }

      const pedacos = EXTENSOES_MARKDOWN.has(extensao)
        ? chunkMarkdownDocument(arquivo.content).map((p) => ({
            content: p.content,
          }))
        : chunkText(arquivo.content);

      if (pedacos.length === 0) {
        filesSkipped++;
        continue;
      }

      arquivosIndexados.add(arquivo.path);
      pedacos.forEach((pedaco, i) => {
        candidatos.push({
          sourcePath: arquivo.path,
          content: pedaco.content,
          chunkIndex: i,
          totalChunks: pedacos.length,
        });
      });
    }

    // Idempotente (RN-231/454): apaga o escopo ANTES de escrever — se todos
    // os arquivos foram pulados, o escopo fica vazio, o que é honesto: não
    // há o que citar.
    await this.chunks.deleteByScope(projectId, 'local');

    const { vectors, available, reason } = await this.embeddings.embedMany(
      candidatos.map((c) => c.content),
    );

    const novos: NewChunk[] = candidatos.map((c, i) => ({
      projectId,
      scope: 'local',
      sourcePath: c.sourcePath,
      content: c.content,
      embedding: vectors[i] ?? null,
      metadata: {
        chunkIndex: c.chunkIndex,
        totalChunks: c.totalChunks,
        uploadedBy: actorId,
        folderName,
      },
    }));

    if (novos.length > 0) await this.chunks.createMany(novos);

    const embedded = vectors.filter((v) => v !== null).length;
    return {
      folderName,
      filesIndexed: arquivosIndexados.size,
      filesSkipped,
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

function extensaoDoArquivo(path: string): string {
  const ponto = path.lastIndexOf('.');
  const barra = path.lastIndexOf('/');
  if (ponto === -1 || ponto < barra) return '';
  return path.slice(ponto).toLowerCase();
}
