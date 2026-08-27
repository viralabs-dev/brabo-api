import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { SearchHuggingFaceModelsUseCase } from '../../../application/use-cases/llm/huggingface/search-huggingface-models.use-case';
import { RequestModelPullUseCase } from '../../../application/use-cases/llm/huggingface/request-model-pull.use-case';
import { ConfirmModelPullUseCase } from '../../../application/use-cases/llm/huggingface/confirm-model-pull.use-case';
import { GetModelPullRequestUseCase } from '../../../application/use-cases/llm/huggingface/get-model-pull-request.use-case';
import { RequireRole } from '../iam/require-role.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { RequestModelPullDto } from './dto/request-model-pull.dto';
import {
  HuggingFaceModelResponseDto,
  ModelPullRequestResponseDto,
} from './dto/huggingface.response.dto';

/**
 * Navegar o Hugging Face Hub e pedir o pull de um modelo para dentro do
 * Ollama, com uma segunda confirmação explícita antes do download rodar de
 * verdade (Project/Workspace Settings — owner/maintainer, mesmo papel de
 * mutação do resto do catálogo de LLM em `models.controller.ts`).
 *
 * ## Por que o pedido de pull vive numa tabela PRÓPRIA, fora de `proposed_actions`
 *
 * `proposed_actions` (pipeline de aprovação do ADR original) existe para um
 * AGENTE ser fiscalizado por um humano: `session_id` é `NOT NULL`,
 * `resolved_policy` vem de `permissions.json`/`decide()`, e as três telas que
 * o consomem (Aprovações, chat da sessão, Insights) mostram uma ação que um
 * AGENTE propôs. Aqui não há agente nenhum — é o PRÓPRIO humano, já
 * controlado pelo papel na rota, agindo direto em Settings, sem sessão. Forçar
 * o encaixe exigiria fabricar um `sessionId` sem sentido e um `actionType`
 * fora do vocabulário fechado de `decide.ts`. `huggingface_model_pull_requests`
 * é o mecanismo pequeno e próprio: a segunda confirmação é modelada pelos
 * dois primeiros estados da própria máquina de status
 * (`pending_confirmation` → `confirmed`), não pelo par approve/deny do outro
 * pipeline.
 *
 * ## Por que `repoId` vai no CORPO do `POST .../pull-requests`, não na rota
 *
 * O formato real do Hub é `<publisher>/<modelo>` — um `/` dentro de um
 * `:repoId` de segmento de path quebra o casamento de rota. Mesma escolha já
 * feita em `code.controller.ts` (FASE 26b) para caminho de arquivo: valor que
 * pode conter `/` vai por query ou corpo, nunca por segmento de path.
 */
@ApiTags('llm')
@ApiBearerAuth(BEARER)
@Controller('workspaces/:workspaceId/huggingface')
export class HuggingFaceModelsController {
  constructor(
    private readonly searchModels: SearchHuggingFaceModelsUseCase,
    private readonly requestPull: RequestModelPullUseCase,
    private readonly confirmPull: ConfirmModelPullUseCase,
    private readonly getPullRequest: GetModelPullRequestUseCase,
  ) {}

  @Get('models')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'Searches GGUF models on the Hugging Face Hub',
    description:
      'Filters to OFFICIAL publishers only by default (the allowlist in ' +
      '`domain/llm/huggingface-official-publishers.ts`) — same "manual ' +
      'curation always" spirit as the LLM catalog (ADR 0042), applied to ' +
      'the "official" badge instead of to activation. `includeCommunity=true` ' +
      'brings in every publisher, each one tagged `official: false` for the ' +
      'screen to render the security warning — never hidden.',
  })
  @ApiQuery({ name: 'q', required: true, description: 'Search text.' })
  @ApiQuery({
    name: 'includeCommunity',
    required: false,
    description: 'Pass `true` to also include non-official publishers.',
  })
  @ApiOkResponse({ type: [HuggingFaceModelResponseDto] })
  @ApiForbiddenResponse({
    description: 'Requires `maintainer` on the workspace.',
  })
  search(
    @Query('q') q?: string,
    @Query('includeCommunity') includeCommunity?: string,
  ) {
    if (!q || q.trim() === '') {
      throw new BadRequestException('Parâmetro `q` é obrigatório');
    }
    return this.searchModels.execute({
      query: q,
      includeCommunity: includeCommunity === 'true',
    });
  }

  @Post('pull-requests')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'Creates a PENDING pull request — nothing downloads yet',
    description:
      'First of two explicit steps: this call only records the intent, in ' +
      '`pending_confirmation`. Nothing is pulled until a separate call to ' +
      '`POST .../pull-requests/:id/confirm` — the product never runs an ' +
      'automatic, silent pull.',
  })
  @ApiCreatedResponse({ type: ModelPullRequestResponseDto })
  @ApiForbiddenResponse({
    description: 'Requires `maintainer` on the workspace.',
  })
  createPullRequest(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: User,
    @Body() dto: RequestModelPullDto,
  ) {
    return this.requestPull.execute({
      workspaceId,
      requestedBy: user.id,
      repoId: dto.repoId,
      estimatedSizeBytes: dto.estimatedSizeBytes ?? null,
    });
  }

  @Post('pull-requests/:id/confirm')
  @HttpCode(200)
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'The second confirmation — actually runs the pull',
    description:
      'Moves `pending_confirmation` → `confirmed` → `pulling`, calls the ' +
      'Ollama daemon, and on success upserts the model into the catalog ' +
      '(`models`) and activates it for THIS workspace. On failure the ' +
      'request ends in `failed` with a reason declaring its origin (infra | ' +
      'model | code | policy) — never a silent failure. This call runs ' +
      'SYNCHRONOUSLY for the whole pull (see the use case for why); use the ' +
      'GET route below to poll instead of holding this connection open.',
  })
  @ApiOkResponse({ type: ModelPullRequestResponseDto })
  @ApiForbiddenResponse({
    description: 'Requires `maintainer` on the workspace.',
  })
  @ApiNotFoundResponse({ description: 'Pull request not found.' })
  confirm(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() user: User,
  ) {
    return this.confirmPull.execute({
      id,
      workspaceId,
      confirmedBy: user.id,
    });
  }

  @Get('pull-requests/:id')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'Status of a pull request, for the frontend to poll',
  })
  @ApiOkResponse({ type: ModelPullRequestResponseDto })
  @ApiForbiddenResponse({
    description: 'Requires `maintainer` on the workspace.',
  })
  @ApiNotFoundResponse({ description: 'Pull request not found.' })
  getStatus(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.getPullRequest.execute(id, workspaceId);
  }
}
