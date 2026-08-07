import { Body, Controller, Get, Param, Query, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequireRole } from '../iam/require-role.decorator';
import { UpsertBudgetUseCase } from '../../../application/use-cases/llm/upsert-budget.use-case';
import { GetBudgetUseCase } from '../../../application/use-cases/llm/get-budget.use-case';
import { GetSessionTokenUsageUseCase } from '../../../application/use-cases/llm/get-session-token-usage.use-case';
import { GetProjectAgentCostsUseCase } from '../../../application/use-cases/llm/get-project-agent-costs.use-case';
import { GetCredentialSpendUseCase } from '../../../application/use-cases/llm/get-credential-spend.use-case';
import { UpsertBudgetDto } from './dto/upsert-budget.dto';
import { BEARER } from '../../../infrastructure/openapi/documento';
import {
  AgentTokenUsageResponseDto,
  BudgetResponseDto,
  CredentialSpendResponseDto,
} from './dto/llm.response.dto';

const MICROS_PER_USD = 1_000_000;

/**
 * Teto de gasto por projeto e por sessão.
 *
 * A ENTRADA fala em dólar (é o que uma pessoa digita); tudo o mais fala em
 * micro-USD. Preço de token é da ordem de 10⁻⁶ e somar float nessa escala
 * acumula erro que aparece na fatura.
 */
@ApiTags('llm')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Papel insuficiente no projeto.' })
@ApiNotFoundResponse({ description: 'Projeto ou sessão inexistente.' })
@Controller()
export class BudgetsController {
  constructor(
    private readonly upsertBudget: UpsertBudgetUseCase,
    private readonly getBudget: GetBudgetUseCase,
    private readonly getSessionTokenUsageUseCase: GetSessionTokenUsageUseCase,
    private readonly getProjectAgentCostsUseCase: GetProjectAgentCostsUseCase,
    private readonly getCredentialSpendUseCase: GetCredentialSpendUseCase,
  ) {}

  @Get('projects/:projectId/budget')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'Lê o orçamento do projeto e o quanto já foi gasto',
    description:
      'Valores em micro-USD. Exige `maintainer` — é informação de custo.',
  })
  @ApiOkResponse({ type: BudgetResponseDto })
  getProjectBudget(@Param('projectId') projectId: string) {
    return this.getBudget.execute('project', projectId);
  }

  @Put('projects/:projectId/budget')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'Define o teto de gasto do projeto',
    description:
      'O limite entra em DÓLARES e é convertido para micro-USD. Com `policy=block` ' +
      'a chamada que estouraria o teto é RECUSADA, não apenas registrada.',
  })
  @ApiOkResponse({ type: BudgetResponseDto })
  setProjectBudget(
    @Param('projectId') projectId: string,
    @Body() dto: UpsertBudgetDto,
  ) {
    return this.upsertBudget.execute('project', projectId, {
      limitMicros: Math.round(dto.limitUsd * MICROS_PER_USD),
      policy: dto.policy,
    });
  }

  @Get('projects/:projectId/sessions/:sessionId/budget')
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Lê o orçamento da sessão e o gasto acumulado',
    description:
      'É o que alimenta o medidor de tokens ao vivo da tela de sessão.',
  })
  @ApiOkResponse({ type: BudgetResponseDto })
  getSessionBudget(@Param('sessionId') sessionId: string) {
    return this.getBudget.execute('session', sessionId);
  }

  // Custo por agente na sessão — o que o painel do time mostra em cada
  // AgentCard (Fase 4a). Mesmo papel de leitura do budget da sessão, mesmo
  // papel exigido.
  @Get('projects/:projectId/sessions/:sessionId/token-usage')
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Quebra o gasto da sessão por agente',
    description:
      'O dado sempre esteve em `token_usage`, mas sem agregação nem rota o painel do ' +
      'time não tinha como mostrar o custo por card. Mesmo papel exigido do ' +
      'orçamento da sessão.',
  })
  @ApiOkResponse({ type: [AgentTokenUsageResponseDto] })
  getSessionTokenUsage(@Param('sessionId') sessionId: string) {
    return this.getSessionTokenUsageUseCase.execute(sessionId);
  }

  // Custo por agente no PROJETO, últimos 30 dias — a coluna "EST. MÊS" e o
  // card de custo do time da tela de Configurações (`design/SCREENS.md`).
  // Irmã da rota acima: mesma agregação, outro recorte.
  @Get('projects/:projectId/agent-costs')
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Quebra o gasto do projeto por agente, nos últimos 30 dias',
    description:
      'Janela DESLIZANTE de 30 dias, não o mês corrente: é o rótulo que a tela ' +
      'mostra, e num mês-calendário a estimativa despencaria no dia 1º por ' +
      'virada de página, não por mudança de uso. Só `actor_kind = agent` entra ' +
      '(RN-038). Agente que nunca rodou não aparece na lista — a tela mostra ' +
      'traço para ele, que é diferente de zero.',
  })
  @ApiOkResponse({ type: [AgentTokenUsageResponseDto] })
  getProjectAgentCosts(@Param('projectId') projectId: string) {
    return this.getProjectAgentCostsUseCase.execute(projectId);
  }

  // Gasto das CHAVES do owner. `owner` e não `maintainer`: desde a RN-058 os
  // agentes gastam a credencial do dono do workspace, e a fatura dele não é
  // assunto de quem só opera o projeto.
  @Get('workspaces/:workspaceId/credential-spend')
  @RequireRole('owner')
  @ApiOperation({
    summary: 'Quanto as chaves do owner gastaram, por provider e por mês',
    description:
      'Existe porque a chave que os agentes gastam é a do OWNER do workspace ' +
      '(RN-058) — quem paga a conta precisa ver a conta. Agrupa por provider ' +
      'porque é essa a unidade da credencial, e separa o que saiu por AGENTE ' +
      'do que saiu por pessoa no chat: as duas coisas saem da mesma chave e ' +
      'respondem perguntas diferentes. Não devolve segredo nenhum.',
  })
  @ApiOkResponse({ type: CredentialSpendResponseDto })
  @ApiForbiddenResponse({ description: 'Exige `owner` no workspace.' })
  getCredentialSpend(
    @Param('workspaceId') workspaceId: string,
    @Query('meses') meses?: string,
  ) {
    const janela = Number(meses);
    return this.getCredentialSpendUseCase.execute(
      workspaceId,
      Number.isFinite(janela) && janela > 0 && janela <= 24 ? janela : 6,
    );
  }

  @Put('projects/:projectId/sessions/:sessionId/budget')
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Define o teto de gasto da sessão',
    description:
      'Mesma conversão de dólar para micro-USD do orçamento de projeto.',
  })
  @ApiOkResponse({ type: BudgetResponseDto })
  setSessionBudget(
    @Param('sessionId') sessionId: string,
    @Body() dto: UpsertBudgetDto,
  ) {
    return this.upsertBudget.execute('session', sessionId, {
      limitMicros: Math.round(dto.limitUsd * MICROS_PER_USD),
      policy: dto.policy,
    });
  }
}
