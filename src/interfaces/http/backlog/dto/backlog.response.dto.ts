import { ApiProperty } from '@nestjs/swagger';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import { STORY_STATUSES } from '../../../../domain/backlog/story-state-machine';
import { PR_GATE_STATUSES } from '../../../../domain/execution/pr-gate-state-machine';
import { FAILURE_ORIGINS } from '../../../../domain/agents/failure-origin';
import type {
  Epic,
  EpicWithStories,
  Story,
  StoryWithTasks,
  Task,
} from '../../../../domain/backlog/backlog.entity';
import type {
  CoverageReport,
  RuleCoverage,
} from '../../../../domain/backlog/coverage';
import type { ModuleMap } from '../../../../domain/architecture/module-map.entity';
import type { ModuleNode } from '../../../../domain/architecture/module-graph';
import type {
  AdrRef,
  Architecture,
  ArchitecturePendency,
} from '../../../../application/use-cases/architecture/get-architecture.use-case';
import type { C4DiagramaGerado } from '../../../../application/use-cases/architecture/create-c4-diagram.use-case';
import { TIPOS_DE_ATOR_C4 } from '../../../../domain/architecture/c4-diagram';
import type {
  C4Ator,
  C4Diagrama,
  EstadoDoC4Diagrama,
} from '../../../../domain/architecture/c4-diagram';
import type { RoteamentoDeModulosGerado } from '../../../../application/use-cases/architecture/route-modules-to-infra.use-case';
import type { RoteamentoDeModulo } from '../../../../domain/architecture/module-routing';
import type { InfraArtifact } from '../../../../domain/execution/infra-artifact.entity';

/**
 * Respostas de backlog, cobertura, arquitetura e artefatos de infra
 * (Fase 7b, item 6).
 *
 * Tudo aqui é LEITURA. Quem escreve épico, história e tarefa são os agentes,
 * pelas rotas `/internal/*` — não há endpoint de usuário que crie backlog, e
 * isso é decisão de produto, não lacuna.
 */

const EXEMPLO_PROJETO = '01JC4Z0000PROJETO0000000001';
const EXEMPLO_SESSAO = '01JC4Z8QK3M7YV2N5T9B0PXHRA';

export class TaskResponseDto implements Wire<Task> {
  @ApiProperty({ example: '01JC4Z0000TAREFA00000000001' })
  id!: string;

  @ApiProperty({ example: '01JC4Z0000HISTORIA000000001' })
  storyId!: string;

  @ApiProperty({ example: 'POST /cart/items endpoint' })
  title!: string;

  @ApiProperty({ example: 'Accepts SKU and quantity; validates stock.' })
  description!: string;

  @ApiProperty({
    enum: ['todo', 'in_progress', 'in_review', 'done'],
    example: 'in_progress',
  })
  status!: Wire<Task>['status'];

  @ApiProperty({
    example: 'dev-api',
    nullable: true,
    description: 'Slug of the dev agent that claimed the task.',
  })
  assignedTo!: string | null;

  @ApiProperty({
    example: false,
    description: 'Task blocked waiting on a decision or a dependency.',
  })
  blocked!: boolean;

  @ApiProperty({ example: null, nullable: true })
  blockedReason!: string | null;

  @ApiProperty({
    enum: FAILURE_ORIGINS,
    example: null,
    nullable: true,
    description:
      'The ORIGIN of the block (ADR 0020/0038), when known. `null` for every ' +
      'Phase 4a block — only the QA Lead (Phase 8b) fills it in.',
  })
  blockedOrigin!: Wire<Task>['blockedOrigin'];

  @ApiProperty({
    enum: PR_GATE_STATUSES,
    example: null,
    nullable: true,
    description:
      "Where the task's PR is in the gate pipeline: QA, then SecOps, then " +
      'the user. `null` while no PR is open.',
  })
  gateStatus!: Wire<Task>['gateStatus'];

  @ApiProperty({
    example: 0,
    description: 'How many correction rounds the gates have already requested.',
  })
  gateCorrectionCount!: number;

  @ApiProperty({ example: '2026-07-25T10:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-25T12:30:00.000Z', format: 'date-time' })
  updatedAt!: string;
}
export const _chavesTask: MesmasChaves<TaskResponseDto, Task> = true;

export class StoryResponseDto implements Wire<Story> {
  @ApiProperty({ example: '01JC4Z0000HISTORIA000000001' })
  id!: string;

  @ApiProperty({ example: '01JC4Z0000EPICO000000000001' })
  epicId!: string;

  @ApiProperty({ example: EXEMPLO_PROJETO })
  projectId!: string;

  @ApiProperty({ example: EXEMPLO_SESSAO })
  sessionId!: string;

  @ApiProperty({ example: 'Add item to cart' })
  title!: string;

  @ApiProperty({
    example: 'As a buyer, I want to gather items before paying.',
  })
  description!: string;

  @ApiProperty({
    example: ['The cart accepts up to 50 items'],
    description: 'Functional requirements.',
  })
  rf!: string[];

  @ApiProperty({
    example: ['The response stays under 200 ms at p95'],
    description: 'Non-functional requirements.',
  })
  rnf!: string[];

  @ApiProperty({
    example: ['RN-014'],
    description:
      'Business rules covered. This is where rule→story coverage is ' +
      'computed in `GET /projects/:id/coverage`.',
  })
  businessRuleIds!: string[];

  @ApiProperty({
    example: ['Unit tests green'],
    description: 'Definition of done.',
  })
  dod!: string[];

  @ApiProperty({
    example: ['Module defined'],
    description: 'Definition of ready.',
  })
  dor!: string[];

  @ApiProperty({
    example: ['api'],
    description:
      'Modules from the `module_map` that the story touches. A story with ' +
      'no module, or with a non-existent module, becomes an architecture ' +
      'pending item.',
  })
  moduleIds!: string[];

  @ApiProperty({ enum: STORY_STATUSES, example: 'ready' })
  status!: Wire<Story>['status'];

  @ApiProperty({
    example: true,
    description:
      "The PO finished the story and it's waiting on the user's decision " +
      '(Phase 12c — RN-048). Coexists with `status: "draft"`: it is a ' +
      'proposal, not a state. Always `false` in a project in `auto` mode.',
  })
  proposedReady!: boolean;

  @ApiProperty({
    example: 'DoD too generic — spell out the acceptance criteria.',
    nullable: true,
    description:
      'Why the user returned the story to the PO. `null` when it was never ' +
      'returned.',
  })
  returnedReason!: string | null;

  @ApiProperty({
    example: '2026-08-02T14:00:00.000Z',
    format: 'date-time',
    nullable: true,
  })
  returnedAt!: string | null;

  @ApiProperty({ example: '2026-07-25T09:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-25T09:40:00.000Z', format: 'date-time' })
  updatedAt!: string;
}
export const _chavesStory: MesmasChaves<StoryResponseDto, Story> = true;

export class StoryComTarefasResponseDto
  extends StoryResponseDto
  implements Wire<StoryWithTasks>
{
  @ApiProperty({ type: [TaskResponseDto] })
  tasks!: TaskResponseDto[];
}
export const _chavesStoryComTarefas: MesmasChaves<
  StoryComTarefasResponseDto,
  StoryWithTasks
> = true;

export class EpicResponseDto implements Wire<Epic> {
  @ApiProperty({ example: '01JC4Z0000EPICO000000000001' })
  id!: string;

  @ApiProperty({ example: EXEMPLO_PROJETO })
  projectId!: string;

  @ApiProperty({ example: EXEMPLO_SESSAO })
  sessionId!: string;

  @ApiProperty({ example: 'Shopping cart' })
  title!: string;

  @ApiProperty({ example: 'Everything the buyer does before paying.' })
  description!: string;

  @ApiProperty({ example: '2026-07-25T08:30:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-25T08:30:00.000Z', format: 'date-time' })
  updatedAt!: string;
}
export const _chavesEpic: MesmasChaves<EpicResponseDto, Epic> = true;

/** The whole tree: epic → stories → tasks. */
export class EpicComHistoriasResponseDto
  extends EpicResponseDto
  implements Wire<EpicWithStories>
{
  @ApiProperty({ type: [StoryComTarefasResponseDto] })
  stories!: StoryComTarefasResponseDto[];
}
export const _chavesEpicComHistorias: MesmasChaves<
  EpicComHistoriasResponseDto,
  EpicWithStories
> = true;

export class RuleCoverageResponseDto implements Wire<RuleCoverage> {
  @ApiProperty({ example: 'RN-014' })
  ruleId!: string;

  @ApiProperty({ example: 'Cart accepts at most 50 items' })
  title!: string;

  @ApiProperty({ example: ['01JC4Z0000HISTORIA000000001'] })
  coveredByStoryIds!: string[];

  @ApiProperty({ example: true })
  covered!: boolean;
}
export const _chavesRuleCoverage: MesmasChaves<
  RuleCoverageResponseDto,
  RuleCoverage
> = true;

/** Rule→story traceability. A rule with no coverage is a pending item for the PO. */
export class CoverageReportResponseDto implements Wire<CoverageReport> {
  @ApiProperty({ type: [RuleCoverageResponseDto] })
  rules!: RuleCoverageResponseDto[];

  @ApiProperty({
    example: 2,
    description:
      'How many rules have no story at all. Each one is a discovery.',
  })
  uncoveredCount!: number;
}
export const _chavesCoverage: MesmasChaves<
  CoverageReportResponseDto,
  CoverageReport
> = true;

export class ModuleNodeResponseDto implements Wire<ModuleNode> {
  @ApiProperty({ example: 'api' })
  name!: string;

  @ApiProperty({ example: 'NestJS + Drizzle' })
  stack!: string;

  @ApiProperty({ example: 'Business rules and HTTP surface.' })
  responsibility!: string;

  @ApiProperty({
    example: ['db'],
    description:
      'Names of other modules. A cycle here gets the map REJECTED on write.',
  })
  dependsOn!: string[];
}
export const _chavesModuleNode: MesmasChaves<
  ModuleNodeResponseDto,
  ModuleNode
> = true;

export class ModuleMapResponseDto implements Wire<ModuleMap> {
  @ApiProperty({ example: '01JC4Z0000MODULEMAP00000001' })
  id!: string;

  @ApiProperty({ example: EXEMPLO_PROJETO })
  projectId!: string;

  @ApiProperty({ example: EXEMPLO_SESSAO })
  sessionId!: string;

  @ApiProperty({ type: [ModuleNodeResponseDto] })
  modules!: ModuleNodeResponseDto[];

  @ApiProperty({
    example: 3,
    description:
      'History is immutable: each new map is one more version, and the ' +
      'current one is the one with the highest `version`.',
  })
  version!: number;

  @ApiProperty({ example: '2026-07-24T16:00:00.000Z', format: 'date-time' })
  createdAt!: string;
}
export const _chavesModuleMap: MesmasChaves<ModuleMapResponseDto, ModuleMap> =
  true;

export class AdrRefResponseDto implements Wire<AdrRef> {
  @ApiProperty({
    example: '01JC4Z8QK3M7YV2N5T9B0PXHRC',
    description:
      'Id of the `open_adr_pr` `proposed_action` that opened the ADR.',
  })
  actionId!: string;

  @ApiProperty({ example: '0007 — Postgres queue instead of Redis' })
  title!: string;

  @ApiProperty({ example: 'executed' })
  status!: string;

  @ApiProperty({
    example: 'https://github.com/daneiel/brabo/pull/42',
    nullable: true,
    description: '`null` while the PR has not actually been opened.',
  })
  pullRequestUrl!: string | null;
}
export const _chavesAdrRef: MesmasChaves<AdrRefResponseDto, AdrRef> = true;

export class ArchitecturePendencyResponseDto implements Wire<ArchitecturePendency> {
  @ApiProperty({ example: '01JC4Z0000HISTORIA000000001' })
  storyId!: string;

  @ApiProperty({ example: 'Add item to cart' })
  title!: string;

  @ApiProperty({ example: 'ready' })
  status!: string;

  @ApiProperty({
    enum: ['no_module', 'missing_module'],
    example: 'missing_module',
    description:
      "`no_module`: the story doesn't point at any module. `missing_module`: " +
      "it points at one that doesn't exist in the current map.",
  })
  reason!: Wire<ArchitecturePendency>['reason'];

  @ApiProperty({
    example: ['pagamentos'],
    description: "The cited modules that don't exist. Empty when `no_module`.",
  })
  missing!: string[];
}
export const _chavesPendencia: MesmasChaves<
  ArchitecturePendencyResponseDto,
  ArchitecturePendency
> = true;

export class C4AtorResponseDto implements Wire<C4Ator> {
  @ApiProperty({ example: 'User' })
  name!: string;

  @ApiProperty({
    enum: TIPOS_DE_ATOR_C4 as unknown as string[],
    example: 'person',
  })
  type!: Wire<C4Ator>['type'];

  @ApiProperty({ example: 'Whoever operates the product through the web.' })
  description!: string;
}
export const _chavesC4Ator: MesmasChaves<C4AtorResponseDto, C4Ator> = true;

export class C4DiagramaResponseDto implements Wire<C4Diagrama> {
  @ApiProperty({ example: 'Brabo' })
  systemName!: string;

  @ApiProperty({ example: 'Agent-orchestrated engineering platform.' })
  systemDescription!: string;

  @ApiProperty({ type: [C4AtorResponseDto] })
  actors!: C4AtorResponseDto[];

  @ApiProperty({
    example: 'C4Context\n  title Context Diagram -- Brabo\n  ...',
    description:
      'Mermaid `C4Context` syntax — the system and the external actors.',
  })
  contextDiagram!: string;

  @ApiProperty({
    example: 'C4Container\n  title Container Diagram -- Brabo\n  ...',
    description:
      "Mermaid `C4Container` syntax — the current module_map's modules and " +
      'the dependencies between them.',
  })
  containerDiagram!: string;
}
export const _chavesC4Diagrama: MesmasChaves<
  C4DiagramaResponseDto,
  C4Diagrama
> = true;

export class EstadoDoC4DiagramaResponseDto implements Wire<EstadoDoC4Diagrama> {
  @ApiProperty({
    enum: ['sem_diagrama', 'gerado'],
    example: 'sem_diagrama',
    description:
      '`sem_diagrama` is the initial state: the Architect has not generated ' +
      'one yet.',
  })
  status!: 'sem_diagrama' | 'gerado';

  @ApiProperty({
    type: C4DiagramaResponseDto,
    nullable: true,
    description: 'The current diagram, or `null` while there is none.',
  })
  diagrama!: C4DiagramaResponseDto | null;

  @ApiProperty({
    example: 0,
    description:
      'Version of the current artifact; 0 when there is no diagram. ' +
      'Revising means generating again — history is never rewritten.',
  })
  version!: number;

  @ApiProperty({ nullable: true, example: '01JC4Z0000EVENTO000000002' })
  eventId!: string | null;

  @ApiProperty({ nullable: true, format: 'date-time' })
  createdAt!: string | null;
}
export const _chavesEstadoC4Diagrama: MesmasChaves<
  EstadoDoC4DiagramaResponseDto,
  EstadoDoC4Diagrama
> = true;

/** The architecture section: current map, ADRs, what's outstanding, and the C4 diagram. */
export class ArchitectureResponseDto implements Wire<Architecture> {
  @ApiProperty({
    type: ModuleMapResponseDto,
    nullable: true,
    description: '`null` while the Architect has not written the first map.',
  })
  moduleMap!: ModuleMapResponseDto | null;

  @ApiProperty({ type: [AdrRefResponseDto] })
  adrs!: AdrRefResponseDto[];

  @ApiProperty({
    type: [ArchitecturePendencyResponseDto],
    description:
      'Story↔map cross-validation. An empty list is the healthy state.',
  })
  pendencies!: ArchitecturePendencyResponseDto[];

  @ApiProperty({ type: EstadoDoC4DiagramaResponseDto })
  c4Diagram!: EstadoDoC4DiagramaResponseDto;
}
export const _chavesArquitetura: MesmasChaves<
  ArchitectureResponseDto,
  Architecture
> = true;

/** Response for `POST .../c4-diagram`: the freshly generated diagram + the version. */
export class C4DiagramaGeradoResponseDto implements Wire<C4DiagramaGerado> {
  @ApiProperty({ type: C4DiagramaResponseDto })
  diagrama!: C4DiagramaResponseDto;

  @ApiProperty({ example: 1 })
  version!: number;
}
export const _chavesC4DiagramaGerado: MesmasChaves<
  C4DiagramaGeradoResponseDto,
  C4DiagramaGerado
> = true;

export class RoteamentoDeModuloResponseDto implements Wire<RoteamentoDeModulo> {
  @ApiProperty({ example: 'checkout-api' })
  modulo!: string;

  @ApiProperty({ example: 'node:22-bookworm-slim' })
  imagemCandidata!: string;

  @ApiProperty({
    example:
      'This module is TypeScript on Node 22; the slim variant has the runtime and nothing else.',
  })
  porque!: string;
}
export const _chavesRoteamentoDeModulo: MesmasChaves<
  RoteamentoDeModuloResponseDto,
  RoteamentoDeModulo
> = true;

/** Response for `POST .../module-routing`: the freshly routed list + the version. */
export class RoteamentoDeModulosGeradoResponseDto implements Wire<RoteamentoDeModulosGerado> {
  @ApiProperty({ type: [RoteamentoDeModuloResponseDto] })
  roteamento!: RoteamentoDeModuloResponseDto[];

  @ApiProperty({ example: 1 })
  version!: number;
}
export const _chavesRoteamentoDeModulosGerado: MesmasChaves<
  RoteamentoDeModulosGeradoResponseDto,
  RoteamentoDeModulosGerado
> = true;

export class InfraArtifactResponseDto implements Wire<InfraArtifact> {
  @ApiProperty({ example: '01JC4Z0000INFRAARTEFATO00001' })
  id!: string;

  @ApiProperty({ example: EXEMPLO_PROJETO })
  projectId!: string;

  @ApiProperty({ example: EXEMPLO_SESSAO })
  sessionId!: string;

  @ApiProperty({ example: "api's production Dockerfile" })
  title!: string;

  @ApiProperty({
    example: '01JC4Z8QK3M7YV2N5T9B0PXHRD',
    description:
      'Id of the `open_infra_pr` `proposed_action` that opened the PR. It is ' +
      'what the engine knows in return — there is no separate artifact id.',
  })
  prActionId!: string;

  @ApiProperty({
    enum: PR_GATE_STATUSES,
    example: 'awaiting_qa',
    description: 'Goes through the SAME QA and SecOps gates as dev PRs.',
  })
  gateStatus!: Wire<InfraArtifact>['gateStatus'];

  @ApiProperty({ example: 0 })
  gateCorrectionCount!: number;

  @ApiProperty({ example: false })
  blocked!: boolean;

  @ApiProperty({ example: null, nullable: true })
  blockedReason!: string | null;

  @ApiProperty({ example: '2026-07-26T09:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-26T09:20:00.000Z', format: 'date-time' })
  updatedAt!: string;
}
export const _chavesInfraArtifact: MesmasChaves<
  InfraArtifactResponseDto,
  InfraArtifact
> = true;
