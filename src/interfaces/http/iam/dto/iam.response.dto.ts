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
import type { GitProviderName } from '@brabo/shared';
import type {
  ProjectCardSummary,
  ProjectUnreadEvents,
  RosterFacts,
} from '../../../../application/ports/projects-summary-repository.port';
import type { ProvisioningStatus } from '../../../../domain/git/repo-bootstrap-status';
import type { SessionEvent } from '../../../../domain/sessions/session-event.entity';
import { SessionEventResponseDto } from '../../sessions/dto/sessions.response.dto';

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

// --- Resumo do dashboard (RN-090) ---

/**
 * Os fatos do event log que decidem QUEM aparece na roster de agentes do
 * card. Não é a roster: ícone, cor, lead de área e agrupamento em chip são
 * catálogo de apresentação e vivem no web (`lib/agents.ts`). A api responde o
 * que aconteceu; a tela decide o que desenha com isso.
 */
export class RosterFactsResponseDto implements Wire<RosterFacts> {
  @ApiProperty({
    example: true,
    description:
      'A sessão mais recente já registrou `execution.activated` — é o que faz os ' +
      'dev agents por módulo entrarem na roster.',
  })
  executionActivated!: boolean;

  @ApiProperty({
    example: ['api', 'web'],
    description:
      'Nomes dos módulos do module_map VIGENTE (maior `version`). Um dev agent por ' +
      'módulo, quando a execução foi ativada.',
  })
  moduleNames!: string[];

  @ApiProperty({
    example: true,
    description:
      'Algum gate de PR (dev ou infra) já abriu ALGUMA VEZ nesta sessão — é o que traz ' +
      'QA e SecOps para a roster. Cobre a sessão inteira, não uma janela dos últimos ' +
      'N eventos.',
  })
  gatesEverOpened!: boolean;

  @ApiProperty({
    example: ['qa-automacao'],
    description:
      'Subagentes com pelo menos uma delegação registrada na sessão, qualquer que seja ' +
      'o desfecho — dispensa é decisão registrada, não silêncio.',
  })
  delegatedSubagents!: string[];

  @ApiProperty({
    example: false,
    description:
      'Existe handoff `accepted` para `infra` na sessão mais recente.',
  })
  infraActive!: boolean;
}
export const _chavesRosterFacts: MesmasChaves<
  RosterFactsResponseDto,
  RosterFacts
> = true;

/** Teto e gasto do projeto, em micro-USD. */
export class ProjectCardBudgetResponseDto implements Wire<
  NonNullable<ProjectCardSummary['budget']>
> {
  @ApiProperty({ example: 50000000 })
  limitMicros!: number;

  @ApiProperty({ example: 12500000 })
  spentMicros!: number;
}

/**
 * Uma linha por projeto com tudo que o card do dashboard desenha.
 *
 * Existe para que a grade custe UMA requisição em vez de sete por card: com 23
 * projetos o dashboard sozinho estourava o rate limit de 300 req/min e a tela
 * inteira voltava 429.
 */
export class ProjectCardSummaryResponseDto implements Wire<ProjectCardSummary> {
  @ApiProperty({ example: '01JC4Z0000PROJETO0000000001' })
  projectId!: string;

  @ApiProperty({
    enum: ['local', 'github', 'gitlab'],
    example: 'github',
    description:
      '`local` quando o projeto ainda não tem repositório provisionado.',
  })
  provider!: GitProviderName;

  @ApiProperty({
    enum: [
      'provisioning',
      'provisioned',
      'provision_failed',
      'awaiting_plan_decision',
    ],
    nullable: true,
    example: 'provisioned',
    description: '`null` quando o bootstrap nunca começou. Derivado do cursor.',
  })
  provisioningStatus!: ProvisioningStatus | null;

  @ApiProperty({
    type: ProjectCardBudgetResponseDto,
    nullable: true,
    description:
      '`null` quando o projeto NUNCA teve orçamento definido — distinto de uma linha ' +
      'zerada, e é o que faz o card oferecer "Definir orçamento".',
  })
  budget!: { limitMicros: number; spentMicros: number } | null;

  @ApiProperty({ example: '01JC4Z0000SESSAO00000000001', nullable: true })
  latestSessionId!: string | null;

  @ApiProperty({
    example: 41,
    description:
      'Último `seq` já gravado na sessão mais recente (`nextSeq - 1`); 0 quando não há ' +
      'sessão. O web compara com o que já foi visto para contar não lidos.',
  })
  latestSeq!: number;

  @ApiProperty({
    type: SessionEventResponseDto,
    nullable: true,
    description:
      'Último evento da sessão mais recente — a linha de rodapé do card.',
  })
  lastEvent!: Wire<SessionEvent> | null;

  @ApiProperty({
    example: 2,
    description:
      'Histórias que o PO terminou e que aguardam a promoção do usuário (RN-048).',
  })
  storiesAwaitingPromotion!: number;

  @ApiProperty({ type: RosterFactsResponseDto })
  roster!: RosterFactsResponseDto;
}
export const _chavesProjectCardSummary: MesmasChaves<
  ProjectCardSummaryResponseDto,
  ProjectCardSummary
> = true;

export class ProjectUnreadEventsResponseDto implements Wire<ProjectUnreadEvents> {
  @ApiProperty({ example: '01JC4Z0000PROJETO0000000001' })
  projectId!: string;

  @ApiProperty({
    example: '01JC4Z0000SESSAO00000000001',
    description:
      'A sessão MAIS RECENTE do projeto — a mesma que `projects-summary` reporta ' +
      'em `latestSessionId`.',
  })
  sessionId!: string;

  @ApiProperty({
    type: [SessionEventResponseDto],
    description:
      'Em ordem DECRESCENTE de `seq` — o primeiro item é o mais recente (RN-100). ' +
      'No máximo 50 por projeto, o mesmo teto que `GET .../events` aplica sem ' +
      '`limit`, e quando há mais não lidos que isso os que voltam são os mais ' +
      'NOVOS. Quantos ficaram de fora sai de `latestSeq` menos o corte, sem outra ' +
      'requisição.',
  })
  events!: Wire<SessionEvent>[];
}
export const _chavesProjectUnreadEvents: MesmasChaves<
  ProjectUnreadEventsResponseDto,
  ProjectUnreadEvents
> = true;
