import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';
import {
  DEV_AGENT_IMPLS,
  type DevAgentImpl,
} from '../../../../domain/execution/dev-agent-impl';

export class ActivateExecutionDto {
  @ApiPropertyOptional({
    example: 500000,
    description:
      'Orçamento por task em micro-USD. Omitido usa o default do domínio ' +
      '(DEFAULT_TASK_BUDGET_MICROS).',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  taskBudgetMicros?: number;

  @ApiPropertyOptional({
    example: 3,
    description:
      'Quantas idas e voltas dev↔gate antes da task virar `blocked`. É o que ' +
      'impede um agente de gastar orçamento em loop de correção.',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  maxGateCorrections?: number;

  @ApiPropertyOptional({
    enum: DEV_AGENT_IMPLS,
    example: 'real',
    description:
      '`noop` sobe os dev agents SEM LLM, para exercitar a infraestrutura de ' +
      'execução de ponta a ponta sem gastar token. Omitido usa `real`.',
  })
  @IsOptional()
  @IsIn(DEV_AGENT_IMPLS)
  devAgentImpl?: DevAgentImpl;

  @ApiPropertyOptional({
    example: ['Terminal(pnpm test:*)', 'Terminal(pnpm lint)'],
    description:
      'Padrões liberados no `permissions.json` para os dev agents rodarem a suite. ' +
      '`deny` continua vencendo o que estiver aqui.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  terminalAllowPatterns?: string[];
}
