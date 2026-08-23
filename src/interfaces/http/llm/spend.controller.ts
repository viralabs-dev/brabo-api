import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { RequireRole } from '../iam/require-role.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { GetWorkspaceSpendReportUseCase } from '../../../application/use-cases/llm/get-workspace-spend-report.use-case';
import { GetMySpendUseCase } from '../../../application/use-cases/llm/get-my-spend.use-case';
import {
  DIAS_MAXIMO,
  DIAS_PADRAO,
  janelaValida,
} from '../../../application/use-cases/llm/spend-report';
import { BEARER } from '../../../infrastructure/openapi/documento';
import {
  MySpendResponseDto,
  WorkspaceSpendReportResponseDto,
} from './dto/llm.response.dto';

/**
 * Duas audiências para o mesmo gasto (FASE 22, ADR 0063, RN-101).
 *
 * As duas rotas leem a MESMA tabela e não respondem a mesma pergunta:
 *
 * - `/workspaces/:id/spend-report` é do OWNER. Quebra por modelo, provider,
 *   projeto, ator e dia — o workspace inteiro. O eixo de provider voltou pelo
 *   ADR 0076 (RN-186) e mora aqui porque esta rota já exigia `owner`, a mesma
 *   régua de `credential-spend` (RN-060), que segue respondendo a pergunta da
 *   FATURA por mês e por chave;
 * - `/projects/:id/spend/me` é do MEMBRO. Só as linhas DELE, em tokens e custo
 *   estimado, sem provider e sem credencial: a chave é do owner (RN-058), e a
 *   fatia de uma fatura alheia não é o que o membro está perguntando.
 *
 * Controller separado do `BudgetsController` de propósito: orçamento é TETO
 * (uma decisão que bloqueia chamada), relatório é HISTÓRICO. Misturá-los faria
 * um arquivo em que "quem pode ler" tem duas respostas diferentes.
 */
@ApiTags('llm')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Insufficient role.' })
@Controller()
export class SpendController {
  constructor(
    private readonly workspaceSpend: GetWorkspaceSpendReportUseCase,
    private readonly mySpend: GetMySpendUseCase,
  ) {}

  @Get('workspaces/:workspaceId/spend-report')
  @RequireRole('owner')
  @ApiOperation({
    summary:
      "Breaks down the workspace's spend by model, provider, project, actor, and day",
    description:
      "The OWNER's audience. The PROVIDER axis came back (ADR 0076, RN-186) " +
      "and is here, not on the member's route, because breaking down by " +
      "provider is breaking down by CREDENTIAL — and credential is whoever " +
      "pays's business (RN-060). Complements `credential-spend`, which keeps " +
      'answering the INVOICE question (per month, with the tie to the key ' +
      'that exists today). Person and agent also come in separate blocks, by ' +
      '`actor_kind`. Sliding window in days, and the daily series comes ' +
      'DENSE — a day with no spend comes in as zero, otherwise the ' +
      'sparkline lies about the pace.',
  })
  @ApiQuery({
    name: 'dias',
    required: false,
    description: `Sliding window. Default ${DIAS_PADRAO}, max ${DIAS_MAXIMO}.`,
  })
  @ApiOkResponse({ type: WorkspaceSpendReportResponseDto })
  @ApiForbiddenResponse({ description: 'Requires `owner` on the workspace.' })
  getWorkspaceSpendReport(
    @Param('workspaceId') workspaceId: string,
    @Query('dias') dias?: string,
  ) {
    return this.workspaceSpend.execute(workspaceId, janelaValida(dias));
  }

  // O ator vem do TOKEN, nunca da rota: não existe forma de pedir o consumo de
  // outra pessoa porque não existe onde escrever o id dela.
  //
  // Nem de pedir uma DIMENSÃO: a rota aceita `dias` e mais nada, então
  // `?dimensao=provider` (ou qualquer outra invenção na query) é ignorado pelo
  // handler antes de chegar a qualquer lugar. É a primeira das duas barreiras
  // do ADR 0076; a segunda é o tipo do port, que recusa `provider` para escopo
  // com ator (RN-187).
  @Get('projects/:projectId/spend/me')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'My own consumption in this project, by session and by day',
    description:
      "The MEMBER's audience. Only the caller's own rows — the actor comes " +
      'from the authenticated token and there is no parameter to swap it. In ' +
      'tokens and ESTIMATED cost, without breaking down by provider or by ' +
      "credential: the key that ran is the owner's (RN-058) and its invoice " +
      "is theirs (RN-060). The provider axis came to exist in the owner's " +
      'report (ADR 0076) and remains unreachable from here — there is no ' +
      'dimension parameter on this route, and the repository type refuses ' +
      "the combination (RN-187). Agent doesn't count: `token_usage` records " +
      'who spent, not who ordered the spend.',
  })
  @ApiQuery({
    name: 'dias',
    required: false,
    description: `Sliding window. Default ${DIAS_PADRAO}, max ${DIAS_MAXIMO}.`,
  })
  @ApiOkResponse({ type: MySpendResponseDto })
  getMySpend(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
    @Query('dias') dias?: string,
  ) {
    return this.mySpend.execute(projectId, user.id, janelaValida(dias));
  }
}
