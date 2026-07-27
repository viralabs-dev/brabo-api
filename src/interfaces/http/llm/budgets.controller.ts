import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { RequireRole } from '../iam/require-role.decorator';
import { UpsertBudgetUseCase } from '../../../application/use-cases/llm/upsert-budget.use-case';
import { GetBudgetUseCase } from '../../../application/use-cases/llm/get-budget.use-case';
import { GetSessionTokenUsageUseCase } from '../../../application/use-cases/llm/get-session-token-usage.use-case';
import { UpsertBudgetDto } from './dto/upsert-budget.dto';

const MICROS_PER_USD = 1_000_000;

@Controller()
export class BudgetsController {
  constructor(
    private readonly upsertBudget: UpsertBudgetUseCase,
    private readonly getBudget: GetBudgetUseCase,
    private readonly getSessionTokenUsageUseCase: GetSessionTokenUsageUseCase,
  ) {}

  @Get('projects/:projectId/budget')
  @RequireRole('maintainer')
  getProjectBudget(@Param('projectId') projectId: string) {
    return this.getBudget.execute('project', projectId);
  }

  @Put('projects/:projectId/budget')
  @RequireRole('maintainer')
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
  getSessionBudget(@Param('sessionId') sessionId: string) {
    return this.getBudget.execute('session', sessionId);
  }

  // Custo por agente na sessão — o que o painel do time mostra em cada
  // AgentCard (Fase 4a). Mesmo papel de leitura do budget da sessão, mesmo
  // papel exigido.
  @Get('projects/:projectId/sessions/:sessionId/token-usage')
  @RequireRole('developer')
  getSessionTokenUsage(@Param('sessionId') sessionId: string) {
    return this.getSessionTokenUsageUseCase.execute(sessionId);
  }

  @Put('projects/:projectId/sessions/:sessionId/budget')
  @RequireRole('developer')
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
