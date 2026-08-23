import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequireRole } from '../iam/require-role.decorator';
import { HybridSearchUseCase } from '../../../application/use-cases/rag/hybrid-search.use-case';
import { ReindexProjectUseCase } from '../../../application/use-cases/rag/reindex-project.use-case';
import { GetRagCoverageUseCase } from '../../../application/use-cases/rag/get-rag-coverage.use-case';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { HybridSearchRequestDto } from './dto/rag.request.dto';
import {
  HybridSearchResponseDto,
  RagCoverageResponseDto,
  ReindexProjectResponseDto,
} from './dto/rag.response.dto';

/**
 * O Chat RAG — indexação e busca híbrida (PROGRAMA 28, Onda 4, frente G2 —
 * RN-231..234, ADR 0080).
 *
 * ## Por que HTTP já nesta onda
 *
 * A tela do Chat RAG é da Onda 5 (`G3`), mas ela depende do contrato de
 * busca e citação existir para poder ser construída sem adivinhar forma —
 * o handoff (`designs/Brabo Chat.dc.html`) já assume "busca híbrida ·
 * embeddings + BM25 · limiar X" e um painel de cobertura, e os dois só têm
 * dado real depois destas três rotas. `search` é `viewer` (leitura, mesma
 * régua da aba Code); `reindex` é `maintainer` (dispara N chamadas ao
 * repositório do projeto e ao provider de embedding — mesma régua de
 * "muda o que o produto gasta sem perguntar" que já vale para o teto de
 * paralelismo de área, RN-083); `coverage` é `viewer`, leitura pura sobre o
 * que já está indexado.
 *
 * ## O que NÃO está aqui
 *
 * Reindexação automática por push/fechamento de sessão — é decisão futura
 * (ADR 0079/0080), não desta rota. `reindex` é sempre disparado por alguém.
 */
@ApiTags('rag')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Insufficient role on the project.' })
@ApiNotFoundResponse({ description: 'Project does not exist.' })
@Controller('projects/:projectId/rag')
export class RagController {
  constructor(
    private readonly search: HybridSearchUseCase,
    private readonly reindex: ReindexProjectUseCase,
    private readonly coverage: GetRagCoverageUseCase,
  ) {}

  @Post('search')
  @RequireRole('viewer')
  @ApiOperation({
    summary: "Hybrid search (vector + lexical) over the project's indexed chunks",
    description:
      'Combines cosine similarity (pgvector) with lexical `ts_rank` ' +
      '(tsvector), each from an independent query, merged by weighted sum ' +
      'and cut off by the threshold (ADR 0080). `vectorAvailable: false` ' +
      'warns when the embedding provider did not respond and the search ran ' +
      'with only the lexical signal — it never pretends to have run the full hybrid.',
  })
  @ApiCreatedResponse({ type: HybridSearchResponseDto })
  buscar(
    @Param('projectId') projectId: string,
    @Body() body: HybridSearchRequestDto,
  ) {
    return this.search.execute({
      projectId,
      query: body.query,
      scopes: body.scopes,
      limit: body.limit,
    });
  }

  @Post('reindex')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: "Reindexes the project's docs/ADR/sessions (idempotent full rebuild)",
    description:
      '"Reindex now" from the Chat RAG panel. Deletes and recreates the chunks ' +
      'of the three honest scopes (RN-219) from the CURRENT state — there is ' +
      'no automatic watcher on push/session close (decision recorded in ' +
      'ADR 0079/0080). Can take a while on projects with many sessions: it runs ' +
      'one indexing pass per session, each possibly calling the embedding ' +
      'provider in batch.',
  })
  @ApiCreatedResponse({ type: ReindexProjectResponseDto })
  reindexar(@Param('projectId') projectId: string) {
    return this.reindex.execute(projectId);
  }

  @Get('coverage')
  @RequireRole('viewer')
  @ApiOperation({
    summary:
      'Index coverage: indexed files/sessions against the real total',
    description:
      'Real count (never estimated) of `.md` files under `docs`/`docs/adr` in ' +
      "the project's repository against how many have a chunk, and the " +
      "project's sessions against how many have a chunk. Does not include " +
      '"N minutes ago" — there is no per-scope indexing timestamp column, and ' +
      'a guessed number would lie (same rule as ADR 0042 for model rating).',
  })
  @ApiOkResponse({ type: RagCoverageResponseDto })
  obterCobertura(@Param('projectId') projectId: string) {
    return this.coverage.execute(projectId);
  }
}
