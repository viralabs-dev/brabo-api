import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { EngineServiceGuard } from '../auth/engine-service.guard';
import { ServiceRoute } from '../auth/service-route.decorator';
import { HybridSearchUseCase } from '../../../application/use-cases/rag/hybrid-search.use-case';
import { SERVICE_TOKEN } from '../../../infrastructure/openapi/documento';
import { RagSearchInternalDto } from './dto/rag-search-internal.dto';
import {
  RagSearchInternalHitResponseDto,
  RagSearchInternalResponseDto,
} from './dto/rag-search-internal.response.dto';

const EXCERPT_MAX_CHARS = 240;

/**
 * `POST /internal/rag/search` — a tool `rag_search` do engine (frente
 * paralela). REUSA `HybridSearchUseCase` (o mesmo motor da rota humana em
 * `rag.controller.ts`) — nenhuma lógica de busca duplicada aqui, só a
 * projeção de `HybridSearchResult` para o formato fechado do contrato:
 * `path`/`chunk`/`excerpt` em vez de `origin`/`chunkId`/scores separados.
 *
 * Não depende do grafo de conhecimento (Neo4j) — o RAG existente é
 * pgvector + léxico, como sempre foi. `degraded` é a MESMA semântica de
 * `vectorAvailable: false` do `HybridSearchUseCase` (RN-233): embedding da
 * consulta indisponível, busca caiu para léxico-only.
 */
@ApiTags('internal')
@ApiSecurity(SERVICE_TOKEN)
@ApiForbiddenResponse({
  description: 'Service token missing or different from the shared one.',
})
@Controller('internal/rag')
@ServiceRoute()
@UseGuards(EngineServiceGuard)
export class InternalRagController {
  constructor(private readonly search: HybridSearchUseCase) {}

  @Post('search')
  @ApiOperation({
    summary: "Hybrid search over the project's RAG index, for the engine's tool",
    description:
      'Same engine as `POST /projects/:projectId/rag/search` (human route), ' +
      "projected into the format the engine's `rag_search` tool expects.",
  })
  @ApiCreatedResponse({ type: RagSearchInternalResponseDto })
  async buscar(
    @Body() dto: RagSearchInternalDto,
  ): Promise<RagSearchInternalResponseDto> {
    const resultado = await this.search.execute({
      projectId: dto.projectId,
      query: dto.query,
      limit: dto.topK,
    });

    const hits: RagSearchInternalHitResponseDto[] = resultado.hits.map(
      (hit) => ({
        path:
          hit.origin.kind === 'file'
            ? hit.origin.sourcePath
            : `session:${hit.origin.sessionId}`,
        chunk: hit.content,
        score: hit.score,
        excerpt: excerto(hit.content),
      }),
    );

    return { hits, degraded: !resultado.vectorAvailable };
  }
}

function excerto(conteudo: string): string {
  if (conteudo.length <= EXCERPT_MAX_CHARS) return conteudo;
  return `${conteudo.slice(0, EXCERPT_MAX_CHARS)}…`;
}
