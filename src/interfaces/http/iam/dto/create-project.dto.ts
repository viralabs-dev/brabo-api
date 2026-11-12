import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  ValidateNested,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TAMANHO_MAXIMO_DO_IDIOMA } from '../../../../domain/iam/idioma-de-resposta';
import {
  PROJECT_EXECUTION_MODES,
  STORY_PROMOTION_MODES,
  type ProjectExecutionMode,
  type StoryPromotionMode,
} from '../../../../domain/iam/project.entity';

export class DegrauDaEscadaDto {
  @ApiProperty({ example: 'claude-sonnet-5' })
  @IsString()
  modelId!: string;

  @ApiProperty({
    example: 2000000,
    description:
      'Fixed per-task cap (micro-USD) while the agent is on this step.',
  })
  @IsInt()
  @IsPositive()
  taskBudgetMicros!: number;
}

export class EscadaDeModelosDto {
  @ApiProperty({
    type: [DegrauDaEscadaDto],
    description:
      'Steps from the smallest model to the largest. The agent climbs one ' +
      'step after 2 iteration-limit blocks on the same task (RN-1142).',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DegrauDaEscadaDto)
  ladder!: DegrauDaEscadaDto[];
}

export class CreateProjectDto {
  @ApiProperty({ example: 'Checkout', minLength: 2 })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({
    example: 'checkout',
    pattern: '^[a-z0-9]+(-[a-z0-9]+)*$',
    description: 'kebab-case. Unique within the workspace.',
  })
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug deve ser kebab-case (ex.: meu-projeto)',
  })
  slug!: string;

  @ApiPropertyOptional({
    example: 3,
    description:
      'Circuit breaker (Phase 12b — RN-047): how many consecutive tasks ' +
      "ending blocked stop the module's dev agent at idle_tripped. Omitted " +
      'uses the domain default (DEFAULT_MAX_CONSECUTIVE_BLOCKED). Applies ' +
      "from the NEXT execution activation onward — doesn't affect agents already running.",
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  maxConsecutiveBlocked?: number;

  @ApiPropertyOptional({
    enum: STORY_PROMOTION_MODES,
    example: 'auto',
    description:
      'Who promotes a story from `draft` to `ready` (Phase 12c — RN-048). ' +
      '`auto` (new-project default since RN-659): a complete story is ' +
      'already born `ready`, with no human step. `manual`: the PO proposes ' +
      'and YOU decide, in the Backlog tab. Changing the default did not ' +
      'rewrite any existing project. The domain validations ' +
      '(DoD/DoR/RF/rule/modules) are the SAME in both modes; the mode only ' +
      'changes who triggers it.',
  })
  @IsOptional()
  @IsIn(STORY_PROMOTION_MODES)
  storyPromotion?: StoryPromotionMode;

  @ApiPropertyOptional({
    enum: PROJECT_EXECUTION_MODES,
    example: 'container',
    description:
      "WHERE this project's command EXECUTES (RN-169/RN-421 — ADR 0072/0104). " +
      '`container` (default): the folder managed by the product inside ' +
      'PROJECT_WORKSPACES_ROOT, the usual behavior. `mounted`: a folder of ' +
      'YOURS, given in `workspacePath`, inside the installation-wide base ' +
      '`BRABO_PROJECTS_BASE` (ADR 0141) — creation validates only the path ' +
      'FORMAT plus that base, and the folder itself is created later, when ' +
      'Infra starts the container (RN-501, ADR 0142). `runner`: a ' +
      'folder of YOURS that does NOT need a bind-mount — creation only ' +
      'validates the path format and the project is born "unverified"; run ' +
      '`brabo-runner --project <id> --dir <folder>` on your machine to ' +
      'confirm it (RN-423).',
  })
  @IsOptional()
  @IsIn(PROJECT_EXECUTION_MODES)
  executionMode?: ProjectExecutionMode;

  @ApiPropertyOptional({
    example: '/home/you/projects/store',
    description:
      "The folder's ABSOLUTE path, required when `executionMode` is " +
      '`mounted` or `runner`, and refused when it is `container`. In BOTH ' +
      'of them only the FORMAT is validated now — absolute, no `..`, not the ' +
      'system root, not a system folder, not overlapping the Brabo checkout ' +
      '(RN-422/RN-423). `mounted` adds one rule: it must sit inside ' +
      '`BRABO_PROJECTS_BASE`, the single folder of your machine the Brabo ' +
      'containers can see (ADR 0141) — with no base configured the mode is ' +
      'not available on this installation and creation says so. Disk is ' +
      'touched later: by the runner in `runner`, and when Infra starts the ' +
      'container in `mounted` (RN-501, ADR 0142).',
  })
  @IsOptional()
  @IsString()
  workspacePath?: string;

  @ApiPropertyOptional({
    example: 'pt-BR',
    maxLength: TAMANHO_MAXIMO_DO_IDIOMA,
    description:
      "The PROJECT's language (RN-619) — shared artifacts and turns with no " +
      'human author use it. Any BCP-47 code the server recognizes, stored ' +
      'canonical; an unrecognized one is a 400. Omitted, the project starts ' +
      "with its creator's effective response language (RN-618: account " +
      'choice > confirmed detection > interface language).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(TAMANHO_MAXIMO_DO_IDIOMA)
  language?: string;

  @ApiPropertyOptional({
    example: 500000,
    description:
      'Cap per dev agent task, in micro-USD. Changing it on PATCH also ' +
      'reaches the live dev agents, from the next lap of each task, with no ' +
      'reactivation (RN-1141). The engine call is best-effort: if it fails ' +
      'the project change stands.',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  taskBudgetMicros?: number;

  @ApiPropertyOptional({
    type: EscadaDeModelosDto,
    description:
      'Model ladder of the project (RN-1142). Omitted uses the default ' +
      '(Haiku 5.5 → Sonnet 5).',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => EscadaDeModelosDto)
  modelEscalation?: EscadaDeModelosDto;
}
