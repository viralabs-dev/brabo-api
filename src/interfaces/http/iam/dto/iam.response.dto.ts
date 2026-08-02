import { ApiProperty } from '@nestjs/swagger';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import { ROLE_ORDER, type Role } from '../../../../domain/iam/role';
import type { Workspace } from '../../../../domain/iam/workspace.entity';
import {
  STORY_PROMOTION_MODES,
  type Project,
  type StoryPromotionMode,
} from '../../../../domain/iam/project.entity';
import type { WorkspaceMember } from '../../../../domain/iam/workspace-member.entity';
import type {
  ProjectMember,
  ProjectMemberWithUser,
} from '../../../../domain/iam/project-member.entity';
import type { WorkspaceWithRole } from '../../../../application/ports/workspace-repository.port';
import type { WorkspaceSummary } from '../../../../application/use-cases/iam/get-workspace-summary.use-case';
import type { ProjectBlockedStatus } from '../../../../application/use-cases/iam/get-projects-status-for-workspace.use-case';

/**
 * Respostas de workspaces, projetos e associações (Fase 7b, item 6).
 *
 * O papel efetivo de alguém num projeto é o MAIOR entre o do projeto e o do
 * workspace — a associação de projeto não rebaixa quem já é `owner` do
 * workspace. Isso é decisão de domínio (`resolveEffectiveRole`), não destes
 * DTOs, mas as descrições apontam para lá porque é onde a surpresa mora.
 */

const PAPEL = {
  enum: ROLE_ORDER,
  example: 'maintainer',
  description:
    'Hierarquia linear: owner > maintainer > developer > viewer. Cada papel inclui ' +
    'as permissões dos seguintes.',
} as const;

export class WorkspaceResponseDto implements Wire<Workspace> {
  @ApiProperty({ example: '01JC4Z0000WORKSPACE00000001' })
  id!: string;

  @ApiProperty({ example: 'Acme Corp' })
  name!: string;

  @ApiProperty({
    example: 'acme-corp',
    description: 'Único no sistema; é ele que aparece na URL.',
  })
  slug!: string;

  @ApiProperty({ example: '01JC4Z0000USUARIO0000000001' })
  createdBy!: string;

  @ApiProperty({ example: '2026-07-20T09:12:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-20T09:12:00.000Z', format: 'date-time' })
  updatedAt!: string;
}
export const _chavesWorkspace: MesmasChaves<WorkspaceResponseDto, Workspace> =
  true;

/** O workspace mais o papel de quem pediu a listagem. */
export class WorkspaceComPapelResponseDto implements Wire<WorkspaceWithRole> {
  @ApiProperty({ type: WorkspaceResponseDto })
  workspace!: WorkspaceResponseDto;

  @ApiProperty({
    ...PAPEL,
    description: 'Papel de QUEM CHAMOU neste workspace.',
  })
  role!: Role;
}
export const _chavesWorkspaceComPapel: MesmasChaves<
  WorkspaceComPapelResponseDto,
  WorkspaceWithRole
> = true;

/** Resumo agregado do workspace pro topo do dashboard de projetos. */
export class WorkspaceSummaryResponseDto implements Wire<WorkspaceSummary> {
  @ApiProperty({
    example: 4,
    description:
      'Quantidade de projetos do workspace. Não há flag de "ativo" no domínio — todo ' +
      'projeto conta.',
  })
  activeProjects!: number;

  @ApiProperty({
    example: 6,
    description:
      'Agentes distintos (actorKind=agent) que gastaram tokens neste mês, somando ' +
      'todos os projetos do workspace — inclui subespecialidades de área (Fase 8).',
  })
  agentCount!: number;

  @ApiProperty({
    example: 12500000,
    description:
      'Gasto do mês corrente, em micro-USD, somado por token_usage.createdAt.',
  })
  spentMicros!: number;
}
export const _chavesWorkspaceSummary: MesmasChaves<
  WorkspaceSummaryResponseDto,
  WorkspaceSummary
> = true;

/** Contagem de tasks bloqueadas de um projeto — dot de status da sidebar. */
export class ProjectBlockedStatusResponseDto implements Wire<ProjectBlockedStatus> {
  @ApiProperty({ example: '01JC4Z0000PROJETO0000000001' })
  projectId!: string;

  @ApiProperty({ example: 2 })
  blockedTaskCount!: number;
}
export const _chavesProjectBlockedStatus: MesmasChaves<
  ProjectBlockedStatusResponseDto,
  ProjectBlockedStatus
> = true;

export class ProjectResponseDto implements Wire<Project> {
  @ApiProperty({ example: '01JC4Z0000PROJETO0000000001' })
  id!: string;

  @ApiProperty({ example: '01JC4Z0000WORKSPACE00000001' })
  workspaceId!: string;

  @ApiProperty({ example: 'Checkout' })
  name!: string;

  @ApiProperty({
    example: 'checkout',
    description: 'Único dentro do workspace.',
  })
  slug!: string;

  @ApiProperty({ example: '01JC4Z0000USUARIO0000000001' })
  createdBy!: string;

  @ApiProperty({
    example: 500000,
    nullable: true,
    description:
      'Teto de tokens por task dos dev agents, em micro-USD. `null` usa o padrão ' +
      'do domínio.',
  })
  taskBudgetMicros!: number | null;

  @ApiProperty({
    example: 3,
    nullable: true,
    description:
      'Circuit breaker por dev agent (Fase 12b — RN-047): tasks consecutivas ' +
      'terminando blocked até parar em idle_tripped. `null` usa o padrão do domínio.',
  })
  maxConsecutiveBlocked!: number | null;

  @ApiProperty({
    enum: STORY_PROMOTION_MODES,
    example: 'manual',
    description:
      'Quem promove story a `ready` (Fase 12c — RN-048). `manual`: o PO propõe ' +
      'e o usuário decide. `auto`: promoção automática na criação (opt-in; é ' +
      'onde os projetos anteriores à 12c ficaram).',
  })
  storyPromotion!: StoryPromotionMode;

  @ApiProperty({ example: '2026-07-21T11:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-21T11:00:00.000Z', format: 'date-time' })
  updatedAt!: string;
}
export const _chavesProjeto: MesmasChaves<ProjectResponseDto, Project> = true;

export class WorkspaceMemberResponseDto implements Wire<WorkspaceMember> {
  @ApiProperty({ example: '01JC4Z0000WORKSPACE00000001' })
  workspaceId!: string;

  @ApiProperty({ example: '01JC4Z0000USUARIO0000000002' })
  userId!: string;

  @ApiProperty(PAPEL)
  role!: Role;

  @ApiProperty({ example: '2026-07-22T08:00:00.000Z', format: 'date-time' })
  createdAt!: string;
}
export const _chavesMembroWs: MesmasChaves<
  WorkspaceMemberResponseDto,
  WorkspaceMember
> = true;

export class ProjectMemberResponseDto implements Wire<ProjectMember> {
  @ApiProperty({ example: '01JC4Z0000PROJETO0000000001' })
  projectId!: string;

  @ApiProperty({ example: '01JC4Z0000USUARIO0000000002' })
  userId!: string;

  @ApiProperty(PAPEL)
  role!: Role;

  @ApiProperty({ example: '2026-07-22T08:05:00.000Z', format: 'date-time' })
  createdAt!: string;
}
export const _chavesMembroProj: MesmasChaves<
  ProjectMemberResponseDto,
  ProjectMember
> = true;

/** Membro do projeto já com nome e e-mail — o que a tela de membros mostra. */
export class ProjectMemberComUsuarioResponseDto implements Wire<ProjectMemberWithUser> {
  @ApiProperty({ example: '01JC4Z0000USUARIO0000000002' })
  userId!: string;

  @ApiProperty({
    ...PAPEL,
    description:
      'Papel EFETIVO: o maior entre o do projeto e o herdado do workspace. Quem é ' +
      '`owner` do workspace não é rebaixado por uma associação de projeto menor.',
  })
  role!: Role;

  @ApiProperty({ example: 'Dev Sênior', nullable: true })
  name!: string | null;

  @ApiProperty({ example: 'dev@brabo.dev' })
  email!: string;
}
export const _chavesMembroComUsuario: MesmasChaves<
  ProjectMemberComUsuarioResponseDto,
  ProjectMemberWithUser
> = true;
