import { ApiProperty } from '@nestjs/swagger';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import type { Handoff } from '../../../../domain/sessions/handoff.entity';
import type { OfertaDeHandoff } from '../../../../application/use-cases/agents/create-handoff.use-case';
import type { ResultadoDaConfirmacaoDeArquitetura } from '../../../../application/use-cases/agents/offer-infra-handoff.use-case';

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
    description:
      'Artifact that motivated the handoff (product_brief, module_map…).',
  })
  artifactId!: string | null;

  @ApiProperty({
    enum: ['offered', 'accepted', 'completed', 'rejected', 'superseded'],
    example: 'offered',
    description:
      'This field is MUTABLE — it is the current state. Each transition also ' +
      'becomes an immutable `handoff.*` event in the log, which is where the ' +
      'history lives. `superseded` (ADR 0182, RN-635): the offer stopped being ' +
      'the current one — the target agent was activated by another path, or a ' +
      'newer offer to the same target in the project replaced it ' +
      '(`handoff.superseded`). Only `offered` can be accepted.',
  })
  status!: Wire<Handoff>['status'];

  @ApiProperty({ example: '2026-07-24T10:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-24T10:05:00.000Z', format: 'date-time' })
  updatedAt!: string;
}
export const _chavesHandoff: MesmasChaves<HandoffResponseDto, Handoff> = true;

/**
 * The CURRENT offer to the target after a create call (ADR 0182, RN-635) —
 * there is at most one `offered` per (project, target).
 */
export class OfertaDeHandoffResponseDto extends HandoffResponseDto {
  @ApiProperty({
    enum: ['criado', 'substituiu_oferta', 'ja_oferecido'],
    example: 'criado',
    description:
      '`criado`: a new offer. `substituiu_oferta`: a new offer, and the ' +
      'pending one(s) to the same target became `superseded`. ' +
      '`ja_oferecido`: no new row — the pending offer already there is ' +
      'returned (same session and no new artifact, or `seAusente`).',
  })
  desfecho!: OfertaDeHandoff['desfecho'];
}
export const _chavesOferta: MesmasChaves<
  OfertaDeHandoffResponseDto,
  OfertaDeHandoff
> = true;

/** Why a target of the architecture confirmation was not triggered again. */
export class AlvoJaAtendidoResponseDto {
  @ApiProperty({ enum: ['infra', 'dev-lead'], example: 'infra' })
  toAgent!: 'infra' | 'dev-lead';

  @ApiProperty({ enum: ['oferta_pendente', 'agente_ativo'] })
  motivo!: 'oferta_pendente' | 'agente_ativo';
}

/** Outcome of confirming the architecture is ready (ADR 0182, RN-635). */
export class ConfirmacaoDeArquiteturaResponseDto {
  @ApiProperty({ example: true, enum: [true] })
  ok!: true;

  @ApiProperty({
    enum: ['confirmado', 'ja_oferecido'],
    description:
      '`confirmado`: at least one target was triggered. `ja_oferecido`: both ' +
      'targets already had a pending offer or were active in the project — ' +
      'nothing was recorded nor asked of the engine (double click, second tab).',
  })
  desfecho!: ResultadoDaConfirmacaoDeArquitetura['desfecho'];

  @ApiProperty({ type: [AlvoJaAtendidoResponseDto] })
  jaAtendidos!: AlvoJaAtendidoResponseDto[];
}

/** Confirmation that the agent has started. */
export class AgenteAtivadoResponseDto {
  @ApiProperty({ example: 'po', description: 'Slug of the activated agent.' })
  agent!: string;

  @ApiProperty({ example: 'active', enum: ['active'] })
  status!: 'active';
}
