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
@ApiForbiddenResponse({ description: 'Insufficient role on the project.' })
@ApiNotFoundResponse({ description: 'Project or session not found.' })
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
    summary: 'Reads the project budget and how much has already been spent',
    description:
      'Values in micro-USD. Requires `maintainer` — it is cost information.',
  })
  @ApiOkResponse({ type: BudgetResponseDto })
  getProjectBudget(@Param('projectId') projectId: string) {
    return this.getBudget.execute('project', projectId);
  }

  @Put('projects/:projectId/budget')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'Sets the project spend cap',
    description:
      'The limit comes in as DOLLARS and is converted to micro-USD. With ' +
      '`policy=block` the call that would exceed the cap is REFUSED, not just recorded.',
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
    summary: 'Reads the session budget and the accumulated spend',
    description: "This is what feeds the session screen's live token meter.",
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
    summary: 'Breaks down the session spend by agent',
    description:
      'The data was always in `token_usage`, but without aggregation or a route ' +
      'the team panel had no way to show the cost per card. Same role ' +
      'required as the session budget.',
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
    summary: 'Breaks down the project spend by agent, over the last 30 days',
    description:
      'A SLIDING 30-day window, not the current calendar month: that is the ' +
      'label the screen shows, and with a calendar month the estimate would ' +
      'plunge on the 1st from the page turning over, not from a change in ' +
      'usage. Only `actor_kind = agent` counts (RN-038). An agent that never ' +
      'ran does not appear in the list — the screen shows a dash for it, ' +
      'which is different from zero.',
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
    summary: "How much the owner's keys spent, by provider and by month",
    description:
      "Exists because the key agents spend is the workspace OWNER's " +
      '(RN-058) — whoever pays the bill needs to see the bill. Groups by ' +
      'provider because that is the unit of the credential, and separates ' +
      'what went out by AGENT from what went out by a person in chat: the ' +
      'two come out of the same key and answer different questions. ' +
      'Returns no secret at all.',
  })
  @ApiOkResponse({ type: CredentialSpendResponseDto })
  @ApiForbiddenResponse({ description: 'Requires `owner` on the workspace.' })
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
    summary: 'Sets the session spend cap',
    description: 'Same dollar-to-micro-USD conversion as the project budget.',
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
