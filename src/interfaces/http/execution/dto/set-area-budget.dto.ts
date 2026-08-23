import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min, ValidateIf } from 'class-validator';

/**
 * Corpo de `PUT projects/:projectId/agent-areas/:key/budget` (ADR 0109,
 * RN-440).
 */
export class SetAreaBudgetDto {
  @ApiProperty({
    example: 20,
    minimum: 0,
    nullable: true,
    description:
      'Cap in DOLLARS for the area — same dollar-in, micro-USD-out ' +
      'convention as the project/session budgets (`BudgetsController`). ' +
      '`null` CLEARS the cap: the area goes back to unlimited, which is ' +
      'also the default for an area that never had one set.',
  })
  // `ValidateIf`, não `IsOptional`: a AUSÊNCIA do campo não é pedido válido
  // (mesmo raciocínio de `RenameSessionDto`) — `null` é o valor explícito
  // que limpa o teto.
  @ValidateIf((_, valor) => valor !== null)
  @IsNumber()
  @Min(0)
  limitUsd!: number | null;
}
