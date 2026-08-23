import { ApiProperty } from '@nestjs/swagger';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import {
  BOOTSTRAP_DIAGNOSTIC_KINDS,
  BOOTSTRAP_PLAN_DECISIONS,
  BOOTSTRAP_STATUSES,
  BOOTSTRAP_STEPS,
  REPO_ORIGINS,
} from '../../../../domain/git/repo-bootstrap.entity';
import type {
  BootstrapDiagnostic,
  BootstrapPlan,
  BootstrapPlanStep,
} from '../../../../domain/git/repo-bootstrap.entity';
import type { ProvisionedRepository } from '../../../../domain/git/provisioned-repository.entity';
import type { ProvisionRepositoryResult } from '../../../../application/use-cases/git/provision-repository.use-case';
import type { AdoptRepositoryResult } from '../../../../application/use-cases/git/adopt-repository.use-case';
import type { DecideBootstrapPlanResult } from '../../../../application/use-cases/git/decide-bootstrap-plan.use-case';
import type { RepoBootstrapStatus } from '../../../../application/use-cases/git/get-repo-bootstrap-status.use-case';

/**
 * Respostas do provisionamento de repositório (Fase 7b, item 6).
 *
 * O bootstrap de Gitflow é IDEMPOTENTE E RETOMÁVEL: cada passo é registrado, e
 * uma falha no meio não obriga a recomeçar. É por isso que o estado é uma rota
 * própria em vez de um campo do repositório.
 */

export class GitAuthorizeUrlResponseDto {
  @ApiProperty({
    example:
      'https://github.com/login/oauth/authorize?client_id=…&state=…&redirect_uri=…',
    description:
      'Where to send the browser. The `state` is signed by HMAC with ' +
      '`GIT_OAUTH_STATE_SECRET` — this is what prevents the callback from ' +
      'being forged.',
  })
  authorizeUrl!: string;
}

export class ProvisionedRepositoryResponseDto implements Wire<ProvisionedRepository> {
  @ApiProperty({ example: '01JC4Z0000REPOSITORIO000001' })
  id!: string;

  @ApiProperty({ example: '01JC4Z0000PROJETO0000000001' })
  projectId!: string;

  @ApiProperty({ enum: ['local', 'github', 'gitlab'], example: 'github' })
  provider!: Wire<ProvisionedRepository>['provider'];

  @ApiProperty({
    example: '904837261',
    description: "The repository's id on the provider.",
  })
  externalId!: string;

  @ApiProperty({ example: 'https://github.com/acme/checkout' })
  url!: string;

  @ApiProperty({
    example: 'main',
    description:
      "The project's policy uses `dev`, `qa`, and `main` as permanent branches.",
  })
  defaultBranch!: string;

  @ApiProperty({ enum: ['public', 'private'], example: 'private' })
  visibility!: Wire<ProvisionedRepository>['visibility'];

  @ApiProperty({
    enum: REPO_ORIGINS,
    example: 'created',
    description:
      '`created` = Brabo created the repository; `adopted` = it pointed to ' +
      'one that already existed. Immutable once recorded (RN-046).',
  })
  origin!: Wire<ProvisionedRepository>['origin'];

  @ApiProperty({ example: '01JC4Z0000USUARIO0000000001' })
  provisionedBy!: string;

  @ApiProperty({ example: '2026-07-23T10:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-23T10:00:00.000Z', format: 'date-time' })
  updatedAt!: string;
}
export const _chavesRepo: MesmasChaves<
  ProvisionedRepositoryResponseDto,
  ProvisionedRepository
> = true;

export class PassoDeBootstrapResponseDto {
  @ApiProperty({ enum: BOOTSTRAP_STEPS, example: 'create_dev_branch' })
  step!: (typeof BOOTSTRAP_STEPS)[number];

  @ApiProperty({ enum: BOOTSTRAP_STATUSES, example: 'running' })
  status!: (typeof BOOTSTRAP_STATUSES)[number];
}

export class ProvisionRepositoryResponseDto implements Wire<ProvisionRepositoryResult> {
  @ApiProperty({ type: ProvisionedRepositoryResponseDto })
  repository!: ProvisionedRepositoryResponseDto;

  @ApiProperty({
    type: PassoDeBootstrapResponseDto,
    description:
      'Where the Gitflow bootstrap stopped. Work continues in the ' +
      'background — track it via `GET /projects/:id/git/bootstrap`.',
  })
  bootstrap!: PassoDeBootstrapResponseDto;
}
export const _chavesProvisionamento: MesmasChaves<
  ProvisionRepositoryResponseDto,
  ProvisionRepositoryResult
> = true;

export class RepoBootstrapStatusResponseDto implements Wire<RepoBootstrapStatus> {
  @ApiProperty({
    enum: [
      'provisioning',
      'provisioned',
      'provision_failed',
      'awaiting_plan_decision',
    ],
    example: 'provisioning',
    nullable: true,
    description:
      '`null` when there was never a provisioning in this project. ' +
      '`awaiting_plan_decision` is an ADOPTED repository with a generated ' +
      'plan not yet decided: nothing runs until someone approves the plan ' +
      'or adopts it as is.',
  })
  status!: Wire<RepoBootstrapStatus>['status'];

  @ApiProperty({
    example: '01JC4Z8QK3M7YV2N5T9B0PXHRA',
    nullable: true,
    description:
      "The bootstrap's DEDICATED session. The progress screen reads its " +
      '`bootstrap.step_*` events to build the live checklist.',
  })
  sessionId!: string | null;

  @ApiProperty({ enum: BOOTSTRAP_STEPS, example: null, nullable: true })
  failedStep!: Wire<RepoBootstrapStatus>['failedStep'];

  @ApiProperty({ example: null, nullable: true })
  lastError!: string | null;

  @ApiProperty({
    example: 1,
    description:
      'How many times the bootstrap has already been attempted. It is ' +
      "idempotent and resumable: repeating doesn't duplicate what already worked.",
  })
  attempts!: number;
}
export const _chavesBootstrap: MesmasChaves<
  RepoBootstrapStatusResponseDto,
  RepoBootstrapStatus
> = true;

// --- Adoption of an existing repository (Phase 12a) ---

export class BootstrapPlanStepResponseDto implements Wire<BootstrapPlanStep> {
  @ApiProperty({ enum: BOOTSTRAP_STEPS, example: 'create_qa_branch' })
  step!: Wire<BootstrapPlanStep>['step'];

  @ApiProperty({
    example: 'git_branch_create',
    description:
      "The same taxonomy as `proposed_actions` — each approved step " +
      'becomes a recorded action when the bootstrap runs.',
  })
  actionType!: string;

  @ApiProperty({
    example: { branchName: 'qa', fromRef: 'dev' },
    description: 'The mutation data: which branch, which file, from where.',
    additionalProperties: true,
  })
  payload!: Record<string, unknown>;
}
export const _chavesPlanoPasso: MesmasChaves<
  BootstrapPlanStepResponseDto,
  BootstrapPlanStep
> = true;

export class BootstrapDiagnosticResponseDto implements Wire<BootstrapDiagnostic> {
  @ApiProperty({
    enum: BOOTSTRAP_DIAGNOSTIC_KINDS,
    example: 'extra_branch',
    description:
      '`extra_branch` is INFORMATIONAL and never blocks: an adopted ' +
      "repository has whatever policy it has, and the bootstrap doesn't delete it.",
  })
  kind!: Wire<BootstrapDiagnostic>['kind'];

  @ApiProperty({
    example: { branchName: 'develop', protected: false },
    additionalProperties: true,
  })
  detail!: Record<string, unknown>;
}
export const _chavesDiagnostico: MesmasChaves<
  BootstrapDiagnosticResponseDto,
  BootstrapDiagnostic
> = true;

export class BootstrapPlanResponseDto implements Wire<BootstrapPlan> {
  @ApiProperty({ example: '2026-08-01T23:45:00.000Z', format: 'date-time' })
  generatedAt!: string;

  @ApiProperty({
    type: [BootstrapPlanStepResponseDto],
    description:
      'What the bootstrap WOULD DO. An empty list = the repository is ' +
      'already how the template wants it, and there is nothing to approve.',
  })
  steps!: BootstrapPlanStepResponseDto[];

  @ApiProperty({
    type: [BootstrapDiagnosticResponseDto],
    description: 'The divergences between the repository and the template.',
  })
  diagnostics!: BootstrapDiagnosticResponseDto[];
}
export const _chavesPlano: MesmasChaves<
  BootstrapPlanResponseDto,
  BootstrapPlan
> = true;

export class AdoptRepositoryResponseDto implements Wire<AdoptRepositoryResult> {
  @ApiProperty({ type: ProvisionedRepositoryResponseDto })
  repository!: ProvisionedRepositoryResponseDto;

  @ApiProperty({
    type: BootstrapPlanResponseDto,
    description:
      'The DRY-RUN: nothing was executed on the repository. Decide via ' +
      '`POST .../bootstrap/plan/approve` or `.../plan/skip`.',
  })
  plan!: BootstrapPlanResponseDto;

  @ApiProperty({
    example: false,
    description:
      '`true` when the project had already adopted THIS repository — ' +
      'nothing was created, the plan was just regenerated over the current state.',
  })
  alreadyAdopted!: boolean;
}
export const _chavesAdocao: MesmasChaves<
  AdoptRepositoryResponseDto,
  AdoptRepositoryResult
> = true;

export class BootstrapPlanEstadoResponseDto {
  @ApiProperty({
    type: BootstrapPlanResponseDto,
    nullable: true,
    description: "`null` when the project has no adopted repository.",
  })
  plan!: BootstrapPlanResponseDto | null;

  @ApiProperty({
    enum: BOOTSTRAP_PLAN_DECISIONS,
    example: null,
    nullable: true,
    description:
      '`null` = plan generated and NOT yet decided. This is the state in ' +
      'which nothing runs (RN-045).',
  })
  decision!: (typeof BOOTSTRAP_PLAN_DECISIONS)[number] | null;

  @ApiProperty({ example: null, nullable: true, format: 'date-time' })
  decidedAt!: string | null;

  @ApiProperty({ example: null, nullable: true })
  decidedBy!: string | null;
}

export class DecideBootstrapPlanResponseDto implements Wire<DecideBootstrapPlanResult> {
  @ApiProperty({ type: ProvisionedRepositoryResponseDto })
  repository!: ProvisionedRepositoryResponseDto;

  @ApiProperty({
    type: PassoDeBootstrapResponseDto,
    description:
      'Where the bootstrap ended up. On `skip` the cursor does NOT ' +
      'advance: no step ran, and the record says so.',
  })
  bootstrap!: PassoDeBootstrapResponseDto;
}
export const _chavesDecisao: MesmasChaves<
  DecideBootstrapPlanResponseDto,
  DecideBootstrapPlanResult
> = true;

/**
 * O estado do provisionamento depois de reconhecer a falha de proteção
 * (achado D). Devolve o status para a tela saber que o projeto ficou
 * alcançável — era ele que a mantinha presa na página de provisionamento.
 */
export class ReconhecerFalhaDeProtecaoResponseDto {
  @ApiProperty({
    example: 'provisioned',
    description:
      'Since `protect_branches` is the LAST step, acknowledging its ' +
      'failure closes the bootstrap — the project becomes reachable from ' +
      'the dashboard.',
  })
  status!: string | null;
}
