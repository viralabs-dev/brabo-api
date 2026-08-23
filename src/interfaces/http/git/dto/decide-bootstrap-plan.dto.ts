import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsNotEmpty } from 'class-validator';

export class DecideBootstrapPlanDto {
  @ApiProperty({
    example: '2026-08-01T23:45:00.000Z',
    format: 'date-time',
    description:
      'The `generatedAt` of the plan you SAW. Optimistic lock: if the plan ' +
      'has been regenerated since then (re-adoption, or the repository ' +
      'changed), the decision is refused with 409 instead of applying a ' +
      "yes given about something else.",
  })
  @IsISO8601()
  @IsNotEmpty()
  planGeneratedAt!: string;
}
