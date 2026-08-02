import { ApiProperty } from '@nestjs/swagger';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import {
  BOOTSTRAP_STATUSES,
  BOOTSTRAP_STEPS,
  REPO_ORIGINS,
} from '../../../../domain/git/repo-bootstrap.entity';
import type { ProvisionedRepository } from '../../../../domain/git/provisioned-repository.entity';
import type { ProvisionRepositoryResult } from '../../../../application/use-cases/git/provision-repository.use-case';
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
    enum: ['provisioning', 'ready', 'failed'],
    example: 'provisioning',
    nullable: true,
    description: '`null` quando nunca houve provisionamento neste projeto.',
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
