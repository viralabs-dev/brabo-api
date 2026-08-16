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
@ApiForbiddenResponse({ description: 'Papel insuficiente no projeto.' })
@ApiNotFoundResponse({ description: 'Projeto inexistente.' })
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
    summary: 'Busca híbrida (vetor + léxico) nos chunks indexados do projeto',
    description:
      'Combina similaridade de cosseno (pgvector) com `ts_rank` léxico ' +
      '(tsvector), cada um por uma consulta independente, fundidas por soma ' +
      'ponderada e cortadas pelo limiar (ADR 0080). `vectorAvailable: false` ' +
      'avisa quando o provider de embedding não respondeu e a busca rodou ' +
      'só com o sinal léxico — nunca finge ter rodado o híbrido completo.',
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
    summary: 'Reindexa docs/ADR/sessões do projeto (full rebuild idempotente)',
    description:
      '"Reindexar agora" do painel do Chat RAG. Apaga e recria os chunks dos ' +
      'três escopos honestos (RN-219) a partir do estado ATUAL — não há ' +
      'watcher automático por push/fechamento de sessão (decisão registrada ' +
      'no ADR 0079/0080). Pode demorar em projetos com muitas sessões: roda ' +
      'uma indexação por sessão, cada uma podendo chamar o provider de ' +
      'embedding em lote.',
  })
  @ApiCreatedResponse({ type: ReindexProjectResponseDto })
  reindexar(@Param('projectId') projectId: string) {
    return this.reindex.execute(projectId);
  }

  @Get('coverage')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Cobertura do índice: arquivos/sessões indexados contra o total real',
    description:
      'Contagem real (nunca estimada) de arquivos `.md` de `docs`/`docs/adr` ' +
      'no repositório do projeto contra quantos têm chunk, e sessões do ' +
      'projeto contra quantas têm chunk. Não inclui "há N minutos" — não há ' +
      'coluna de timestamp de indexação por escopo, e um número chutado ' +
      'mentiria (mesma régua do ADR 0042 para nota de modelo).',
  })
  @ApiOkResponse({ type: RagCoverageResponseDto })
  obterCobertura(@Param('projectId') projectId: string) {
    return this.coverage.execute(projectId);
  }
}
