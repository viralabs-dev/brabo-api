import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import {
  PROJECT_EXECUTION_MODES,
  STORY_PROMOTION_MODES,
  type ProjectExecutionMode,
  type StoryPromotionMode,
} from '../../../../domain/iam/project.entity';

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
    example: 'manual',
    description:
      'Who promotes a story from `draft` to `ready` (Phase 12c — RN-048). ' +
      '`manual` (new-project default): the PO proposes and YOU decide, in ' +
      'the Backlog tab. `auto`: a complete story is already born `ready`, ' +
      'with no human step — this was the behavior up through 12c, and ' +
      'projects created before it stayed on it. The domain validations ' +
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
      'YOURS, given in `workspacePath`, that needs to be mounted inside the ' +
      "api's and engine's containers — creation REFUSES (400) a path that " +
      "isn't, with instructions on how to mount it (RN-422). `runner`: a " +
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
      '`mounted` or `runner`, and refused when it is `container`. In ' +
      '`mounted`, validated on creation: it needs to exist and be writable ' +
      'from inside the container, and cannot be the system root, a system ' +
      'folder, nor overlap with the Brabo checkout (RN-422). In `runner`, ' +
      'only the FORMAT is validated now — existence is confirmed later, by the runner (RN-423).',
  })
  @IsOptional()
  @IsString()
  workspacePath?: string;
}
