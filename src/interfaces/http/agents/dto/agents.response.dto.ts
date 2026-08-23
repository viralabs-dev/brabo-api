import { ApiProperty } from '@nestjs/swagger';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import type { Handoff } from '../../../../domain/sessions/handoff.entity';

/** Respostas dos agentes conversacionais e dos handoffs (Fase 7b, item 6). */

export class HandoffResponseDto implements Wire<Handoff> {
  @ApiProperty({ example: '01JC4Z0000HANDOFF00000000001' })
  id!: string;

  @ApiProperty({ example: '01JC4Z8QK3M7YV2N5T9B0PXHRA' })
  sessionId!: string;

  @ApiProperty({ example: '01JC4Z0000PROJETO0000000001' })
  projectId!: string;

  @ApiProperty({
    example: 'criativo',
    description: 'Slug of the agent that passed the baton.',
  })
  fromAgent!: string;

  @ApiProperty({ example: 'po', description: 'Slug of the receiving agent.' })
  toAgent!: string;

  @ApiProperty({
    example: '01JC4Z0000ARTEFATO000000001',
    nullable: true,
    description: 'Artifact that motivated the handoff (product_brief, module_map…).',
  })
  artifactId!: string | null;

  @ApiProperty({
    enum: ['offered', 'accepted', 'completed', 'rejected'],
    example: 'offered',
    description:
      'This field is MUTABLE — it is the current state. Each transition also ' +
      'becomes an immutable `handoff.*` event in the log, which is where the ' +
      'history lives.',
  })
  status!: Wire<Handoff>['status'];

  @ApiProperty({ example: '2026-07-24T10:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-24T10:05:00.000Z', format: 'date-time' })
  updatedAt!: string;
}
export const _chavesHandoff: MesmasChaves<HandoffResponseDto, Handoff> = true;

/** Confirmation that the agent has started. */
export class AgenteAtivadoResponseDto {
  @ApiProperty({ example: 'po', description: 'Slug of the activated agent.' })
  agent!: string;

  @ApiProperty({ example: 'active', enum: ['active'] })
  status!: 'active';
}
