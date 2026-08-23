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
      'Budget per task in micro-USD. Omitted uses the domain default ' +
      '(DEFAULT_TASK_BUDGET_MICROS).',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  taskBudgetMicros?: number;

  @ApiPropertyOptional({
    example: 3,
    description:
      'How many dev↔gate round trips before the task becomes `blocked`. It is ' +
      'what stops an agent from spending its budget in a correction loop.',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  maxGateCorrections?: number;

  @ApiPropertyOptional({
    enum: DEV_AGENT_IMPLS,
    example: 'real',
    description:
      '`noop` starts the dev agents WITHOUT an LLM, to exercise the execution ' +
      'infrastructure end to end without spending tokens. Omitted uses `real`.',
  })
  @IsOptional()
  @IsIn(DEV_AGENT_IMPLS)
  devAgentImpl?: DevAgentImpl;

  @ApiPropertyOptional({
    example: ['Terminal(pnpm test:*)', 'Terminal(pnpm lint)'],
    description:
      'Patterns released in `permissions.json` for the dev agents to run the ' +
      'test suite. `deny` still wins over anything listed here.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  terminalAllowPatterns?: string[];

  @ApiPropertyOptional({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description:
      'Id of the CHAT session the "activate execution" click came from — the ' +
      "Dev Lead/PO's creative/consultative session, never the execution one. " +
      'Omitted (legacy caller, e.g. activation from the Overview without ' +
      'session context) closes no session, same as before. When given, it is ' +
      'closed at the end — but only if it has no pending handoff/action/turn ' +
      '(RN-135), and never if it is the execution session itself.',
  })
  @IsOptional()
  @IsString()
  originSessionId?: string;
}
