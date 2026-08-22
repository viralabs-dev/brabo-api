import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { EngineServiceGuard } from '../auth/engine-service.guard';
import { ServiceRoute } from '../auth/service-route.decorator';
import { GetProjectGitRemoteUseCase } from '../../../application/use-cases/git/get-project-git-remote.use-case';
import { ListBusinessRulesUseCase } from '../../../application/use-cases/backlog/list-business-rules.use-case';
import { ListBacklogUseCase } from '../../../application/use-cases/backlog/list-backlog.use-case';
import { ListProductMetricsUseCase } from '../../../application/use-cases/backlog/list-product-metrics.use-case';
import { ConfirmProjectWorkspaceUseCase } from '../../../application/use-cases/iam/confirm-project-workspace.use-case';
import { SERVICE_TOKEN } from '../../../infrastructure/openapi/documento';
import { ProjectGitRemoteResponseDto } from './dto/project-git-remote.response.dto';
import { ProjectBusinessRulesResponseDto } from './dto/internal.response.dto';
import { EpicComHistoriasResponseDto } from '../backlog/dto/backlog.response.dto';
import { ProductMetricsResponseDto } from './dto/product-metrics.response.dto';
import { ConfirmProjectWorkspaceInternalDto } from './dto/confirm-project-workspace-internal.dto';
import { ConfirmProjectWorkspaceResponseDto } from './dto/confirm-project-workspace.response.dto';

/**
 * O que o engine precisa da api sobre um PROJETO — e não sobre uma sessão.
 *
 * Duas famílias moram aqui, e o critério é o mesmo: o recurso é do projeto, e
 * o segmento de sessão seria decorativo.
 *
 * 1. O repositório de trabalho
 *    ([ADR 0056](../../../../../docs/adr/0056-o-engine-trabalha-em-repositorio-remoto.md)).
 *    A divisão é a mesma do sync de catálogo: quem trabalha no sistema de
 *    arquivos é o engine, quem tem as credenciais é a api. Replicar a chave
 *    mestra no engine pouparia uma chamada HTTP e dobraria o raio de explosão
 *    do segredo mais sensível do produto.
 * 2. O que o PO precisa RELER
 *    ([RN-164](../../../../../docs/business-rules.md#rn-164)): as regras de
 *    negócio do projeto, o backlog já escrito e — desde a RN-407 — o
 *    relatório de funil/DORA parcial (`analise:funil`, ADR 0089). O PO só
 *    tinha ferramenta de escrita e lia o contexto uma única vez, no
 *    kickoff — dali em diante não sabia o que existia nem o que ele mesmo
 *    já tinha criado. As três são LEITURA e por isso não viram
 *    `proposed_action`; o que elas devem é ser contidas, e são: escopo
 *    fechado no projeto, sem parâmetro de busca e sem paginação a explorar.
 */
@ApiTags('internal')
@ApiSecurity(SERVICE_TOKEN)
@ApiForbiddenResponse({
  description: 'Service token ausente ou diferente do compartilhado.',
})
@Controller('internal/projects')
@ServiceRoute()
@UseGuards(EngineServiceGuard)
export class InternalProjectsController {
  constructor(
    private readonly getGitRemote: GetProjectGitRemoteUseCase,
    private readonly listBusinessRules: ListBusinessRulesUseCase,
    private readonly listBacklog: ListBacklogUseCase,
    private readonly listProductMetrics: ListProductMetricsUseCase,
    private readonly confirmWorkspace: ConfirmProjectWorkspaceUseCase,
  ) {}

  @Get(':projectId/git-remote')
  @ApiOperation({
    summary: 'O remoto de trabalho do projeto, para buscar e empurrar',
    description:
      'Devolve a origem limpa (sem credencial embutida) e, para provider ' +
      'remoto, o token do OWNER do workspace (RN-058) decifrado na hora. ' +
      'Quem consome injeta o token por invocação e NUNCA o escreve em ' +
      'arquivo — o `.git/config` fica dentro da pasta onde a RN-075 dá ' +
      'leitura auto-aprovada ao dev agent.',
  })
  @ApiOkResponse({ type: ProjectGitRemoteResponseDto })
  @ApiNotFoundResponse({
    description:
      'Projeto sem repositório provisionado, ou owner do workspace sem ' +
      'credencial cadastrada para o provider do repositório.',
  })
  gitRemote(@Param('projectId') projectId: string) {
    return this.getGitRemote.execute(projectId);
  }

  @Get(':projectId/business-rules')
  @ApiOperation({
    summary: 'As regras de negócio do projeto, com cobertura, para o PO ler',
    description:
      'Todo `artifact.business_rule` das sessões do projeto — não só as da ' +
      'sessão corrente, que era o teto do contexto de kickoff do PO — com a ' +
      '`description` inteira e quais histórias já citam cada regra. ' +
      '`uncoveredCount` é a pendência: regra que nenhuma história cobre ' +
      '(RN-164). Projeto sem regra nenhuma responde `200` com lista vazia: ' +
      '"ainda não capturei regra" não é erro.',
  })
  @ApiOkResponse({ type: ProjectBusinessRulesResponseDto })
  businessRules(@Param('projectId') projectId: string) {
    return this.listBusinessRules.execute(projectId);
  }

  @Get(':projectId/backlog')
  @ApiOperation({
    summary: 'O backlog do projeto em árvore, para o PO ler o que já escreveu',
    description:
      'A MESMA árvore épico → história → tarefa da aba Backlog, pelo mesmo ' +
      'caso de uso (três leituras por projeto, nunca N+1). É com ela que o ' +
      'PO enxerga épico órfão e história sem tarefa em vez de recriar o que ' +
      'já existe (RN-164).',
  })
  @ApiOkResponse({ type: [EpicComHistoriasResponseDto] })
  backlog(@Param('projectId') projectId: string) {
    return this.listBacklog.execute(projectId);
  }

  @Get(':projectId/product-metrics')
  @ApiOperation({
    summary: 'O funil de entrega e DORA parcial do projeto, para o PO ler',
    description:
      'O MESMO relatório do script `analise:funil` (ADR 0089) — funil ' +
      'sessão → commit → PR → merge, lead time real e deployment frequency ' +
      'real — pelas mesmas funções puras e a mesma query ' +
      '(`apps/api/src/application/services/funil-metrics.ts`), para que os ' +
      'dois nunca divirjam do mesmo fato. Fecha `docs/fluxo.yml` (papel ' +
      '`po`, entrada `metricas-de-produto`, antes `status: lacuna`) ' +
      '(RN-407).',
  })
  @ApiOkResponse({ type: ProductMetricsResponseDto })
  @ApiNotFoundResponse({ description: 'Projeto inexistente.' })
  productMetrics(@Param('projectId') projectId: string) {
    return this.listProductMetrics.execute(projectId);
  }

  @Post(':projectId/workspace-verification')
  // Reconcilia o estado do projeto; não cria recurso endereçável.
  @HttpCode(200)
  @ApiOperation({
    summary: 'O runner confirma o caminho de um projeto "runner" (RN-423)',
    description:
      'Chamada só pelo engine, depois de um runner conectar e mandar ' +
      '`workspace_confirm` pelo canal. O runner é a FONTE DA VERDADE do ' +
      'caminho — a api sobrescreve `workspacePath` com o que ele reportou, ' +
      'depois de revalidar léxico (raiz de sistema/sobreposição com o ' +
      'Brabo continuam proibidas mesmo vindo do runner). Idempotente: ' +
      'reconectar com o MESMO caminho não regrava nada.',
  })
  @ApiOkResponse({ type: ConfirmProjectWorkspaceResponseDto })
  @ApiBadRequestResponse({
    description:
      'Caminho lexicamente inválido, ou o projeto não está no modo "runner".',
  })
  @ApiNotFoundResponse({ description: 'Projeto inexistente.' })
  confirmWorkspaceVerification(
    @Param('projectId') projectId: string,
    @Body() dto: ConfirmProjectWorkspaceInternalDto,
  ) {
    return this.confirmWorkspace.execute(projectId, {
      path: dto.path,
      sessionId: dto.sessionId,
      actorId: dto.actorId,
    });
  }
}
