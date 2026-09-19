import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import type { RoutingPreference } from '@brabo/shared';
import { PREFERENCIAS_DE_ROTEAMENTO } from '../../../../domain/llm/routing-preference';

export class SetModelBindingDto {
  @ApiProperty({
    format: 'uuid',
    example: '9b1c2d3e-4f50-4a61-8b72-0c3d4e5f6a7b',
    description: 'Model to pin to this scope. Must exist in `GET /models`.',
  })
  @IsUUID()
  modelId!: string;

  @ApiProperty({
    enum: PREFERENCIAS_DE_ROTEAMENTO,
    required: false,
    nullable: true,
    example: 'throughput',
    description:
      'How a HUB picks the upstream that serves the model (ADR 0166, RN-583). ' +
      "ABSENT keeps the stored value when the new model's provider accepts " +
      'it, and clears it otherwise; `null` clears it; a value for a model ' +
      'whose provider does not declare the `routingPreference` capability ' +
      '(`GET /llm/provider-capabilities`) is refused with 422. It travels ' +
      'WITH this binding: it never cascades on its own.',
  })
  @IsOptional()
  @IsIn(PREFERENCIAS_DE_ROTEAMENTO)
  routingPreference?: RoutingPreference | null;
}
