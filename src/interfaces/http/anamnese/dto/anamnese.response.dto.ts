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
    example: 'Corrigiu três erros de tipagem genérica sem ajuda.',
    description:
      'Os "porquês" do nível. Sem isto o perfil seria um veredito sem apelo.',
  })
  rationale!: string;

  @ApiProperty({
    example: ['01JC4Z8QK3M7YV2N5T9B0PXHRB'],
    description: 'Eventos do log que sustentam o nível.',
  })
  evidenceEventIds!: string[];

  @ApiProperty({ example: '2026-07-26T12:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-26T12:00:00.000Z', format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ example: 'Dev Sênior', nullable: true })
  userName!: string | null;

  @ApiProperty({
    example: 'dev@brabo.dev',
    nullable: true,
    description:
      '`null` quando quem tem perfil já não é membro do projeto — o perfil sobrevive ' +
      'à remoção do membro.',
  })
  userEmail!: string | null;
}
export const _chavesPerfil: MesmasChaves<
  ProficiencyProfileResponseDto,
  ProficiencyProfileView
> = true;

/** Confirmação do apagamento do próprio perfil. */
export class PerfilApagadoResponseDto {
  @ApiProperty({ example: 2, description: 'Quantos perfis foram apagados.' })
  deleted!: number;

  @ApiProperty({
    example: true,
    description:
      'Sempre `true`: apagar SEM registrar o opt-out seria cosmético, porque a ' +
      'rodada seguinte re-derivaria tudo.',
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

  @ApiProperty({ example: 'Sempre rode a suíte antes de abrir a PR.' })
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
    example: '# dev-api\n\nSempre rode a suíte antes de abrir a PR.',
  })
  content!: string;

  @ApiProperty({ example: null, nullable: true })
  createdBy!: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description:
      'A `proposed_action` de patch que produziu esta versão, se houve uma.',
  })
  sourceActionId!: string | null;

  @ApiProperty({
    example: '01JC4Z0000HIPOTESE000000001',
    nullable: true,
    description:
      'A hipótese do Psicólogo que motivou o patch — o loop fechado.',
  })
  sourceHypothesisId!: string | null;

  @ApiProperty({ example: 'Critério de pronto explícito', nullable: true })
  note!: string | null;

  @ApiProperty({ example: '2026-07-26T14:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: true, description: 'Se esta é a versão em vigor.' })
  isCurrent!: boolean;

  @ApiProperty({
    type: TextDiffResponseDto,
    description:
      'Diff desta versão contra a anterior, calculado no servidor para a UI não ' +
      'precisar de um differ próprio. A mais antiga é diffada contra vazio, então ' +
      'aparece como tudo-adição.',
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
      'Slug real, incluindo os dev agents por módulo. A listagem NÃO parte de um ' +
      'roster estático — se partisse, os agentes que existem de verdade não apareceriam.',
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
    description: 'A versão cujo conteúdo foi restaurado.',
  })
  restoredFrom!: number;

  @ApiProperty({
    example: 5,
    description:
      'A versão NOVA que o rollback criou. O histórico é imutável: restaurar não ' +
      'apaga nada, acrescenta.',
  })
  toVersion!: number;

  @ApiProperty({
    example: true,
    description:
      'Se o cache de instruções do engine foi invalidado com sucesso.',
  })
  cacheInvalidated!: boolean;
}
