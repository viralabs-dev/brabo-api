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
      'Para onde mandar o browser. O `state` é assinado por HMAC com ' +
      '`GIT_OAUTH_STATE_SECRET` — é isso que impede o callback de ser forjado.',
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
    description: 'Id do repositório no provider.',
  })
  externalId!: string;

  @ApiProperty({ example: 'https://github.com/acme/checkout' })
  url!: string;

  @ApiProperty({
    example: 'main',
    description:
      'A política do projeto usa `dev`, `qa` e `main` como permanentes.',
  })
  defaultBranch!: string;

  @ApiProperty({ enum: ['public', 'private'], example: 'private' })
  visibility!: Wire<ProvisionedRepository>['visibility'];

  @ApiProperty({
    enum: REPO_ORIGINS,
    example: 'created',
    description:
      '`created` = o Brabo criou o repositório; `adopted` = apontou para um que ' +
      'já existia. Imutável depois de gravado (RN-046).',
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
      'Onde o bootstrap de Gitflow parou. O trabalho continua em segundo plano — ' +
      'acompanhe por `GET /projects/:id/git/bootstrap`.',
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
      '`null` quando nunca houve provisionamento neste projeto. ' +
      '`awaiting_plan_decision` é repositório ADOTADO com plano gerado e ainda ' +
      'não decidido: nada roda até alguém aprovar o plano ou adotar como está.',
  })
  status!: Wire<RepoBootstrapStatus>['status'];

  @ApiProperty({
    example: '01JC4Z8QK3M7YV2N5T9B0PXHRA',
    nullable: true,
    description:
      'Sessão DEDICADA do bootstrap. A tela de progresso lê os eventos ' +
      '`bootstrap.step_*` dela para montar o checklist ao vivo.',
  })
  sessionId!: string | null;

  @ApiProperty({ enum: BOOTSTRAP_STEPS, example: null, nullable: true })
  failedStep!: Wire<RepoBootstrapStatus>['failedStep'];

  @ApiProperty({ example: null, nullable: true })
  lastError!: string | null;

  @ApiProperty({
    example: 1,
    description:
      'Quantas vezes o bootstrap já foi tentado. Ele é idempotente e retomável: ' +
      'repetir não duplica o que já deu certo.',
  })
  attempts!: number;
}
export const _chavesBootstrap: MesmasChaves<
  RepoBootstrapStatusResponseDto,
  RepoBootstrapStatus
> = true;

// --- Adoção de repositório existente (Fase 12a) ---

export class BootstrapPlanStepResponseDto implements Wire<BootstrapPlanStep> {
  @ApiProperty({ enum: BOOTSTRAP_STEPS, example: 'create_qa_branch' })
  step!: Wire<BootstrapPlanStep>['step'];

  @ApiProperty({
    example: 'git_branch_create',
    description:
      'A mesma taxonomia de `proposed_actions` — cada passo aprovado vira uma ' +
      'ação registrada quando o bootstrap roda.',
  })
  actionType!: string;

  @ApiProperty({
    example: { branchName: 'qa', fromRef: 'dev' },
    description: 'Os dados da mutação: qual branch, qual arquivo, de onde.',
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
      '`extra_branch` é INFORMATIVO e nunca bloqueia: repositório adotado tem a ' +
      'política que tem, e o bootstrap não a apaga.',
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
      'O que o bootstrap FARIA. Lista vazia = o repositório já está como o ' +
      'template quer, e não há o que aprovar.',
  })
  steps!: BootstrapPlanStepResponseDto[];

  @ApiProperty({
    type: [BootstrapDiagnosticResponseDto],
    description: 'As divergências entre o repositório e o template.',
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
      'O DRY-RUN: nada foi executado no repositório. Decida por ' +
      '`POST .../bootstrap/plan/approve` ou `.../plan/skip`.',
  })
  plan!: BootstrapPlanResponseDto;

  @ApiProperty({
    example: false,
    description:
      '`true` quando o projeto já tinha adotado ESTE repositório — nada foi ' +
      'criado, o plano só foi regerado sobre o estado atual.',
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
    description: '`null` quando o projeto não tem repositório adotado.',
  })
  plan!: BootstrapPlanResponseDto | null;

  @ApiProperty({
    enum: BOOTSTRAP_PLAN_DECISIONS,
    example: null,
    nullable: true,
    description:
      '`null` = plano gerado e ainda NÃO decidido. É o estado em que nada roda ' +
      '(RN-045).',
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
      'Onde o bootstrap ficou. Em `skip` o cursor NÃO avança: nenhum passo ' +
      'rodou, e o registro diz isso.',
  })
  bootstrap!: PassoDeBootstrapResponseDto;
}
export const _chavesDecisao: MesmasChaves<
  DecideBootstrapPlanResponseDto,
  DecideBootstrapPlanResult
> = true;
