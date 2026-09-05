import { ApiProperty } from '@nestjs/swagger';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import { ROLE_ORDER, type Role } from '../../../../domain/iam/role';
import type { Workspace } from '../../../../domain/iam/workspace.entity';
import {
  PROJECT_EXECUTION_MODES,
  STORY_PROMOTION_MODES,
  type Project,
  type ProjectExecutionMode,
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
    'Linear hierarchy: owner > maintainer > developer > viewer. Each role ' +
    'includes the permissions of the ones after it.',
} as const;

export class WorkspaceResponseDto implements Wire<Workspace> {
  @ApiProperty({ example: '01JC4Z0000WORKSPACE00000001' })
  id!: string;

  @ApiProperty({ example: 'Acme Corp' })
  name!: string;

  @ApiProperty({
    example: 'acme-corp',
    description: "Unique in the system; it's what appears in the URL.",
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
    description: "The CALLER's role in this workspace.",
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
      'Number of projects in the workspace. There is no "active" flag in ' +
      'the domain — every project counts.',
  })
  activeProjects!: number;

  @ApiProperty({
    example: 6,
    description:
      'Distinct agents (actorKind=agent) that spent tokens this month, ' +
      "summed across all of the workspace's projects — includes area " +
      'subspecialties (Phase 8).',
  })
  agentCount!: number;

  @ApiProperty({
    example: 12500000,
    description:
      "Current month's spend, in micro-USD, summed by token_usage.createdAt.",
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
    description: 'Unique within the workspace.',
  })
  slug!: string;

  @ApiProperty({
    example: 'checkout-3f2b1c8e',
    description:
      "Name of this project's physical workspace folder in " +
      'PROJECT_WORKSPACES_ROOT (RN-109). `<slug>-<8 id chars>` on a new ' +
      'project; the raw UUID on a project created before this column ' +
      "existed. Frozen at creation — editing `slug` later doesn't recompute it.",
  })
  workspaceDirName!: string;

  @ApiProperty({
    enum: PROJECT_EXECUTION_MODES,
    example: 'container',
    description:
      'WHERE the command executes (RN-169/RN-421 — ADR 0072/0104). ' +
      '`container`: the folder managed in PROJECT_WORKSPACES_ROOT. ' +
      "`mounted`: the user's folder in `workspacePath`, inside " +
      '`BRABO_PROJECTS_BASE` and reached through the base bind-mount (ADR ' +
      "0141). `runner`: the user's folder confirmed by the runner. Both " +
      '`mounted` and `runner` report the confirmation in ' +
      '`workspaceVerifiedAt`.',
  })
  executionMode!: ProjectExecutionMode;

  @ApiProperty({
    example: null,
    nullable: true,
    description:
      "The user's folder absolute path — filled in for `mounted`/`runner`, " +
      'always `null` in `container` mode.',
  })
  workspacePath!: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description:
      'When the path was confirmed on disk. `null` = not yet verified. In ' +
      '`runner` the confirmation comes from the CLI connecting (RN-423); in ' +
      '`mounted` it is stamped when Infra starts the container and the ' +
      'folder is materialized (RN-501, ADR 0142). `container` never fills ' +
      'this field in. It records A confirmation, never a heartbeat.',
  })
  workspaceVerifiedAt!: string | null;

  @ApiProperty({ example: '01JC4Z0000USUARIO0000000001' })
  createdBy!: string;

  @ApiProperty({
    example: 500000,
    nullable: true,
    description:
      'Token cap per dev agent task, in micro-USD. `null` uses the domain default.',
  })
  taskBudgetMicros!: number | null;

  @ApiProperty({
    example: 3,
    nullable: true,
    description:
      'Circuit breaker per dev agent (Phase 12b — RN-047): consecutive ' +
      'tasks ending blocked before stopping at idle_tripped. `null` uses ' +
      'the domain default.',
  })
  maxConsecutiveBlocked!: number | null;

  @ApiProperty({
    enum: STORY_PROMOTION_MODES,
    example: 'manual',
    description:
      'Who promotes a story to `ready` (Phase 12c — RN-048). `manual`: the ' +
      'PO proposes and the user decides. `auto`: automatic promotion on ' +
      'creation (opt-in; where projects predating 12c ended up).',
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
      'EFFECTIVE role: the higher of the project one and the one inherited ' +
      "from the workspace. Whoever is workspace `owner` isn't downgraded by " +
      'a lesser project association.',
  })
  role!: Role;

  @ApiProperty({ example: 'Senior Dev', nullable: true })
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
      'The most recent session has already recorded `execution.activated` ' +
      '— this is what brings per-module dev agents into the roster.',
  })
  executionActivated!: boolean;

  @ApiProperty({
    example: ['api', 'web'],
    description:
      'Module names from the CURRENT module_map (highest `version`). One ' +
      'dev agent per module, once execution has been activated.',
  })
  moduleNames!: string[];

  @ApiProperty({
    example: true,
    description:
      'Some PR gate (dev or infra) has opened AT LEAST ONCE in this session ' +
      '— this is what brings QA and SecOps into the roster. Covers the ' +
      'whole session, not a window of the last N events.',
  })
  gatesEverOpened!: boolean;

  @ApiProperty({
    example: ['qa-automacao'],
    description:
      'Subagents with at least one delegation recorded in the session, ' +
      'whatever the outcome — dismissal is a recorded decision, not silence.',
  })
  delegatedSubagents!: string[];

  @ApiProperty({
    example: false,
    description:
      'An `accepted` handoff to `infra` exists in the most recent session.',
  })
  infraActive!: boolean;

  @ApiProperty({
    example: false,
    description:
      'An `accepted` handoff to `ux-designer` exists in the most recent session (ADR 0087).',
  })
  uxDesignerActive!: boolean;

  @ApiProperty({
    example: false,
    description:
      'An `accepted` handoff to `staff` exists in the most recent session ' +
      '(docs/fluxo.yml, ADR 0088) — dormant for automatic triggering, only ' +
      'reflects an already-accepted MANUAL activation.',
  })
  staffActive!: boolean;
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
      "`local` when the project doesn't have a provisioned repository yet.",
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
    description:
      '`null` when the bootstrap never started. Derived from the cursor.',
  })
  provisioningStatus!: ProvisioningStatus | null;

  @ApiProperty({
    type: ProjectCardBudgetResponseDto,
    nullable: true,
    description:
      '`null` when the project NEVER had a budget set — distinct from a ' +
      'zeroed-out row, and this is what makes the card offer "Set budget".',
  })
  budget!: { limitMicros: number; spentMicros: number } | null;

  @ApiProperty({ example: '01JC4Z0000SESSAO00000000001', nullable: true })
  latestSessionId!: string | null;

  @ApiProperty({
    example: 41,
    description:
      'Last `seq` already recorded in the most recent session ' +
      '(`nextSeq - 1`); 0 when there is no session. The web compares this ' +
      'against what has already been seen to count unread.',
  })
  latestSeq!: number;

  @ApiProperty({
    type: SessionEventResponseDto,
    nullable: true,
    description:
      "The most recent session's last event — the card's footer line.",
  })
  lastEvent!: Wire<SessionEvent> | null;

  @ApiProperty({
    example: 2,
    description:
      "Stories the PO finished and that are awaiting the user's promotion (RN-048).",
  })
  storiesAwaitingPromotion!: number;

  @ApiProperty({
    example: 8,
    description:
      '`proposed_actions` with `status = pending` across the WHOLE ' +
      'project, all sessions — not just the most recent one. This is what ' +
      "the sidebar shows as the project's badge (RN-151).",
  })
  pendingApprovalsCount!: number;

  @ApiProperty({
    example: 2,
    description:
      'How many agents are ONLINE right now — working or with a pending ' +
      'item awaiting a decision (RN-409). Never team size: an ' +
      '`idle`/`idle_tripped` dev agent does not count, an `idle` ' +
      'conversational agent does not count, QA/SecOps never count (single verdict per invocation).',
  })
  onlineAgentCount!: number;

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
      "The project's MOST RECENT session — the same one `projects-summary` " +
      'reports in `latestSessionId`.',
  })
  sessionId!: string;

  @ApiProperty({
    type: [SessionEventResponseDto],
    description:
      'In DESCENDING `seq` order — the first item is the most recent ' +
      '(RN-100). At most 50 per project, the same cap `GET .../events` ' +
      'applies without `limit`, and when there are more unread than that ' +
      'the ones returned are the NEWEST. How many were left out comes from ' +
      '`latestSeq` minus the cutoff, without another request.',
  })
  events!: Wire<SessionEvent>[];
}
export const _chavesProjectUnreadEvents: MesmasChaves<
  ProjectUnreadEventsResponseDto,
  ProjectUnreadEvents
> = true;

/**
 * A base dos projetos no modo `mounted`, como o cliente a enxerga (ADR 0141,
 * RN-500).
 *
 * DTO de UM campo, e ele é `nullable` de propósito: `null` não é erro nem
 * falha de leitura — é a instalação dizendo "esta máquina não oferece o modo
 * Pasta montada". É por aqui que a criação de projeto aprende a NÃO oferecer
 * um modo que a instalação não honra, em vez de oferecer e recusar depois.
 *
 * Sem `MesmasChaves` contra um tipo de domínio porque não há domínio nenhum
 * aqui: o valor é configuração da INSTALAÇÃO, lido de `BRABO_PROJECTS_BASE`
 * pela mesma função (`baseDeProjetos`) que a regra de criação/conversão vai
 * usar. Uma cópia do valor em outro lugar seria a segunda fonte que um dia
 * diverge.
 */
export class ProjectsBaseResponseDto {
  @ApiProperty({
    example: '/home/voce/brabo',
    nullable: true,
    description:
      "The single folder on the operator's computer that the Brabo " +
      'containers can see, mounted by IDENTITY (`$X:$X`) into `api` and ' +
      '`engine` (ADR 0141). `null` means `BRABO_PROJECTS_BASE` is not set: ' +
      'the installation offers no Mounted mode, and the project wizard must ' +
      'not offer it. Never a failure — absent is a normal state.',
  })
  projectsBase!: string | null;
}

/**
 * Uma listagem do navegador de pastas de projeto (RN-504).
 *
 * ## Por que cinco campos, e não só `entries`
 *
 * Porque `entries` sozinho MENTE. Ele só traz diretório — arquivo e symlink
 * são deliberadamente omitidos —, e uma pasta cheia de código, ou cheia de
 * links, chegaria como lista vazia e a tela diria "pasta vazia". É o defeito
 * que a RN-180 nomeia: tela que mostra um RECORTE diz que é recorte.
 * `arquivos` e `simbolicos` são a declaração do que ficou de fora, e
 * `truncado` é a declaração de que nem tudo que caberia coube.
 *
 * `base` vem em TODA resposta, e não só em `GET .../projects-base`, porque é
 * ela que dá sentido a `path`: o cliente sabe onde a navegação começa e até
 * onde ela sobe sem precisar de uma segunda chamada. `null` — em `base` e em
 * `path` juntos — é a instalação sem `BRABO_PROJECTS_BASE`: normal, nunca
 * erro, e é assim que o assistente de criação aprende a não oferecer o modo
 * Pasta montada.
 */
export class ProjectFoldersResponseDto {
  @ApiProperty({
    example: '/home/voce/brabo',
    nullable: true,
    description:
      'The mounted-projects base of this installation (`BRABO_PROJECTS_BASE`, ' +
      'ADR 0141) — the same value `GET .../projects-base` returns, repeated ' +
      'here so a client can render the breadcrumb without a second call. ' +
      '`null` means the installation offers no Mounted mode.',
  })
  base!: string | null;

  @ApiProperty({
    example: '/home/voce/brabo/clientes',
    nullable: true,
    description:
      'The folder actually listed, normalized. Equals `base` when the ' +
      'request omitted `path`. `null` only when there is no base at all: ' +
      'nothing was listed because there is nowhere to list.',
  })
  path!: string | null;

  @ApiProperty({
    type: [String],
    example: ['api', 'loja', 'website'],
    description:
      'The SUBDIRECTORY names directly under `path`, sorted, never ' +
      'recursive. Files, symlinks and dot-prefixed entries are excluded — ' +
      'see `arquivos`, `simbolicos` and `truncado`.',
  })
  entries!: string[];

  @ApiProperty({
    example: false,
    description:
      'The folder holds more than 500 subdirectories and only the first 500 ' +
      'came back. Sorting happens BEFORE the cut, so the cut is ' +
      'deterministic instead of "whatever the filesystem returned first".',
  })
  truncado!: boolean;

  @ApiProperty({
    example: 12,
    description:
      'How many non-directory entries were left out. A folder full of code ' +
      'must not look empty (RN-180).',
  })
  arquivos!: number;

  @ApiProperty({
    example: 1,
    description:
      'How many symlinks were left out. The browser never follows one — a ' +
      'link is reported, never descended into, so a link pointing outside ' +
      'the base is not a way out of it.',
  })
  simbolicos!: number;
}
