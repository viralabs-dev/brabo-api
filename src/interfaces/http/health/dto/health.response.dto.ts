import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { HealthStatus } from '@brabo/shared';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';

/** A resposta de `/live` e `/health`. Mesma forma nos dois. */
export class HealthStatusResponseDto implements Wire<HealthStatus> {
  @ApiProperty({ enum: ['api', 'engine'], example: 'api' })
  service!: Wire<HealthStatus>['service'];

  @ApiProperty({ enum: ['ok', 'error'], example: 'ok' })
  status!: Wire<HealthStatus>['status'];

  @ApiProperty({ example: '2026-07-27T15:40:00.000Z', format: 'date-time' })
  timestamp!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'Only when `status=error`, with the failure message. A healthy response has ' +
      'no detail at all, on purpose: liveness is not the place to expose topology.',
  })
  details?: Record<string, unknown>;
}
export const _chavesHealth: MesmasChaves<
  HealthStatusResponseDto,
  HealthStatus
> = true;
