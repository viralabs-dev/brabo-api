import { ApiProperty } from '@nestjs/swagger';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import { PROFICIENCY_LEVELS } from '../../../../domain/anamnese/proficiency-validation';
import type { ProficiencyProfileView } from '../../../../domain/anamnese/proficiency-profile.entity';
import type {
  DiffLine,
  TextDiff,
} from '../../../../domain/instructions/text-diff';
import type { InstructionVersionView } from '../../../../application/use-cases/instructions/list-instruction-versions.use-case';

/**
 * Respostas da Anamnese e do histórico de instruções (Fase 7b, item 6).
 *
 * O perfil de proficiência é dado SOBRE a pessoa, e o contrato reflete isso:
 * por default cada um vê o próprio, e apagar o próprio perfil é direito de
 * `viewer` — não de `developer`.
 */

export class ProficiencyProfileResponseDto implements Wire<ProficiencyProfileView> {
  @ApiProperty({ example: '01JC4Z0000PERFIL00000000001' })
  id!: string;

  @ApiProperty({ example: '01JC4Z0000PROJETO0000000001' })
  projectId!: string;

  @ApiProperty({ example: '01JC4Z0000USUARIO0000000002' })
  userId!: string;

  @ApiProperty({ example: 'TypeScript' })
  competency!: string;

  @ApiProperty({ enum: PROFICIENCY_LEVELS, example: 'avancado' })
  level!: Wire<ProficiencyProfileView>['level'];

  @ApiProperty({
    example: 'Fixed three generic typing errors without help.',
    description:
      'The "whys" behind the level. Without this the profile would be a verdict with no appeal.',
  })
  rationale!: string;

  @ApiProperty({
    example: ['01JC4Z8QK3M7YV2N5T9B0PXHRB'],
    description: 'Log events that support the level.',
  })
  evidenceEventIds!: string[];

  @ApiProperty({ example: '2026-07-26T12:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-26T12:00:00.000Z', format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ example: 'Senior Dev', nullable: true })
  userName!: string | null;

  @ApiProperty({
    example: 'dev@brabo.dev',
    nullable: true,
    description:
      '`null` when whoever has the profile is no longer a project member — the ' +
      "profile survives the member's removal.",
  })
  userEmail!: string | null;
}
export const _chavesPerfil: MesmasChaves<
  ProficiencyProfileResponseDto,
  ProficiencyProfileView
> = true;

/** Confirmação do apagamento do próprio perfil. */
export class PerfilApagadoResponseDto {
  @ApiProperty({ example: 2, description: 'How many profiles were deleted.' })
  deleted!: number;

  @ApiProperty({
    example: true,
    description:
      'Always `true`: deleting WITHOUT recording the opt-out would be cosmetic, ' +
      'because the next round would re-derive everything.',
  })
  optedOut!: true;
}

/** Confirmação da volta ao perfilamento. */
export class PerfilOptInResponseDto {
  @ApiProperty({ example: false })
  optedOut!: false;
}

export class DiffLineResponseDto implements Wire<DiffLine> {
  @ApiProperty({ enum: ['add', 'del', 'ctx'], example: 'add' })
  kind!: Wire<DiffLine>['kind'];

  @ApiProperty({ example: 'Always run the suite before opening the PR.' })
  content!: string;

  @ApiProperty({ example: 42, required: false })
  lineNo?: number;
}
export const _chavesDiffLine: MesmasChaves<DiffLineResponseDto, DiffLine> =
  true;

export class TextDiffResponseDto implements Wire<TextDiff> {
  @ApiProperty({ type: [DiffLineResponseDto] })
  lines!: DiffLineResponseDto[];

  @ApiProperty({ example: 3 })
  additions!: number;

  @ApiProperty({ example: 1 })
  deletions!: number;
}
export const _chavesTextDiff: MesmasChaves<TextDiffResponseDto, TextDiff> =
  true;

export class InstructionVersionResponseDto implements Wire<InstructionVersionView> {
  @ApiProperty({ example: '01JC4Z0000VERSAO00000000001' })
  id!: string;

  @ApiProperty({ example: 4 })
  version!: number;

  @ApiProperty({
    example: '# dev-api\n\nAlways run the suite before opening the PR.',
  })
  content!: string;

  @ApiProperty({ example: null, nullable: true })
  createdBy!: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description:
      'The patch `proposed_action` that produced this version, if there was one.',
  })
  sourceActionId!: string | null;

  @ApiProperty({
    example: '01JC4Z0000HIPOTESE000000001',
    nullable: true,
    description:
      "The Psychologist's hypothesis that motivated the patch — the closed loop.",
  })
  sourceHypothesisId!: string | null;

  @ApiProperty({
    example: 'Explicit definition-of-done criterion',
    nullable: true,
  })
  note!: string | null;

  @ApiProperty({ example: '2026-07-26T14:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({
    example: true,
    description: 'Whether this is the version in effect.',
  })
  isCurrent!: boolean;

  @ApiProperty({
    type: TextDiffResponseDto,
    description:
      'Diff of this version against the previous one, computed server-side so ' +
      'the UI does not need its own differ. The oldest one is diffed against ' +
      'empty, so it shows up as all-addition.',
  })
  diff!: TextDiffResponseDto;
}
export const _chavesVersao: MesmasChaves<
  InstructionVersionResponseDto,
  InstructionVersionView
> = true;

/** O histórico de um agente, na listagem que cobre o projeto inteiro. */
export class AgenteComVersoesResponseDto {
  @ApiProperty({
    example: 'dev-api',
    description:
      'Real slug, including the per-module dev agents. The listing does NOT ' +
      'start from a static roster — if it did, the agents that actually exist would not show up.',
  })
  agent!: string;

  @ApiProperty({ type: [InstructionVersionResponseDto] })
  versions!: InstructionVersionResponseDto[];
}

export class RollbackResponseDto {
  @ApiProperty({ example: 'dev-api' })
  agent!: string;

  @ApiProperty({
    example: 2,
    description: 'The version whose content was restored.',
  })
  restoredFrom!: number;

  @ApiProperty({
    example: 5,
    description:
      'The NEW version the rollback created. History is immutable: restoring ' +
      'deletes nothing, it adds.',
  })
  toVersion!: number;

  @ApiProperty({
    example: true,
    description:
      "Whether the engine's instruction cache was successfully invalidated.",
  })
  cacheInvalidated!: boolean;
}
