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
@ApiForbiddenResponse({ description: 'Papel insuficiente.' })
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
      'Quebra o gasto do workspace por modelo, provider, projeto, ator e dia',
    description:
      'A audiência do OWNER. O eixo de PROVIDER voltou (ADR 0076, RN-186) e ' +
      'está aqui, e não na rota do membro, porque quebrar por provider é ' +
      'quebrar por CREDENCIAL — e credencial é assunto de quem paga (RN-060). ' +
      'Complementa `credential-spend`, que segue respondendo a pergunta da ' +
      'FATURA (por mês, com o vínculo à chave que existe hoje). Pessoa e ' +
      'agente também vêm em blocos separados, por `actor_kind`. Janela ' +
      'deslizante em dias, e a série diária vem DENSA — dia sem gasto entra ' +
      'com zero, senão a sparkline mente sobre o ritmo.',
  })
  @ApiQuery({
    name: 'dias',
    required: false,
    description: `Janela deslizante. Padrão ${DIAS_PADRAO}, máximo ${DIAS_MAXIMO}.`,
  })
  @ApiOkResponse({ type: WorkspaceSpendReportResponseDto })
  @ApiForbiddenResponse({ description: 'Exige `owner` no workspace.' })
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
    summary: 'O meu consumo neste projeto, por sessão e por dia',
    description:
      'A audiência do MEMBRO. Só as linhas de quem chama — o ator sai do token ' +
      'autenticado e não há parâmetro para trocá-lo. Em tokens e custo ' +
      'ESTIMADO, sem quebrar por provider nem por credencial: a chave que rodou ' +
      'é a do owner (RN-058) e a fatura dela é dele (RN-060). O eixo de ' +
      'provider passou a existir no relatório do owner (ADR 0076) e continua ' +
      'inalcançável daqui — não há parâmetro de dimensão nesta rota, e o tipo ' +
      'do repositório recusa a combinação (RN-187). Agente não entra: ' +
      '`token_usage` registra quem gastou, não quem mandou gastar.',
  })
  @ApiQuery({
    name: 'dias',
    required: false,
    description: `Janela deslizante. Padrão ${DIAS_PADRAO}, máximo ${DIAS_MAXIMO}.`,
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
