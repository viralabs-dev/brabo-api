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

  @ApiProperty({ example: 'Endpoint POST /carrinho/itens' })
  title!: string;

  @ApiProperty({ example: 'Aceita SKU e quantidade; valida estoque.' })
  description!: string;

  @ApiProperty({
    enum: ['todo', 'in_progress', 'in_review', 'done'],
    example: 'in_progress',
  })
  status!: Wire<Task>['status'];

  @ApiProperty({
    example: 'dev-api',
    nullable: true,
    description: 'Slug do dev agent que reivindicou a tarefa.',
  })
  assignedTo!: string | null;

  @ApiProperty({
    example: false,
    description: 'Tarefa travada esperando decisão ou dependência.',
  })
  blocked!: boolean;

  @ApiProperty({ example: null, nullable: true })
  blockedReason!: string | null;

  @ApiProperty({
    enum: FAILURE_ORIGINS,
    example: null,
    nullable: true,
    description:
      'A ORIGEM do bloqueio (ADR 0020/0038), quando conhecida. `null` pra todo ' +
      'bloqueio da Fase 4a — só o QA Lead (Fase 8b) a preenche.',
  })
  blockedOrigin!: Wire<Task>['blockedOrigin'];

  @ApiProperty({
    enum: PR_GATE_STATUSES,
    example: null,
    nullable: true,
    description:
      'Onde a PR da tarefa está na esteira de gates: QA, depois SecOps, depois o ' +
      'usuário. `null` enquanto não há PR aberta.',
  })
  gateStatus!: Wire<Task>['gateStatus'];

  @ApiProperty({
    example: 0,
    description: 'Quantas rodadas de correção os gates já pediram.',
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

  @ApiProperty({ example: 'Adicionar item ao carrinho' })
  title!: string;

  @ApiProperty({
    example: 'Como comprador, quero juntar itens antes de pagar.',
  })
  description!: string;

  @ApiProperty({
    example: ['O carrinho aceita até 50 itens'],
    description: 'Requisitos funcionais.',
  })
  rf!: string[];

  @ApiProperty({
    example: ['A resposta fica abaixo de 200 ms no p95'],
    description: 'Requisitos não funcionais.',
  })
  rnf!: string[];

  @ApiProperty({
    example: ['RN-014'],
    description:
      'Regras de negócio cobertas. É por aqui que a cobertura regra→história é ' +
      'calculada em `GET /projects/:id/coverage`.',
  })
  businessRuleIds!: string[];

  @ApiProperty({
    example: ['Testes de unidade verdes'],
    description: 'Definition of done.',
  })
  dod!: string[];

  @ApiProperty({
    example: ['Módulo definido'],
    description: 'Definition of ready.',
  })
  dor!: string[];

  @ApiProperty({
    example: ['api'],
    description:
      'Módulos do `module_map` que a história toca. História sem módulo, ou com ' +
      'módulo inexistente, vira pendência de arquitetura.',
  })
  moduleIds!: string[];

  @ApiProperty({ enum: STORY_STATUSES, example: 'ready' })
  status!: Wire<Story>['status'];

  @ApiProperty({
    example: true,
    description:
      'O PO terminou a história e ela aguarda a decisão do usuário (Fase 12c — ' +
      'RN-048). Convive com `status: "draft"`: é uma proposta, não um estado. ' +
      'Sempre `false` em projeto no modo `auto`.',
  })
  proposedReady!: boolean;

  @ApiProperty({
    example: 'DoD genérico demais — detalhe o critério de aceite.',
    nullable: true,
    description:
      'Por que o usuário devolveu a história ao PO. `null` quando nunca foi ' +
      'devolvida.',
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

  @ApiProperty({ example: 'Carrinho de compras' })
  title!: string;

  @ApiProperty({ example: 'Tudo que o comprador faz antes de pagar.' })
  description!: string;

  @ApiProperty({ example: '2026-07-25T08:30:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-25T08:30:00.000Z', format: 'date-time' })
  updatedAt!: string;
}
export const _chavesEpic: MesmasChaves<EpicResponseDto, Epic> = true;

/** A árvore inteira: épico → histórias → tarefas. */
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

  @ApiProperty({ example: 'Carrinho aceita no máximo 50 itens' })
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

/** Rastreabilidade regra→história. Regra sem cobertura é pendência do PO. */
export class CoverageReportResponseDto implements Wire<CoverageReport> {
  @ApiProperty({ type: [RuleCoverageResponseDto] })
  rules!: RuleCoverageResponseDto[];

  @ApiProperty({
    example: 2,
    description:
      'Quantas regras não têm história nenhuma. Cada uma é uma descoberta.',
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

  @ApiProperty({ example: 'Regras de negócio e superfície HTTP.' })
  responsibility!: string;

  @ApiProperty({
    example: ['db'],
    description:
      'Nomes de outros módulos. Um ciclo aqui faz o mapa ser REJEITADO na escrita.',
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
      'O histórico é imutável: cada mapa novo é uma versão a mais, e o vigente é o ' +
      'de maior `version`.',
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
    description: 'Id da `proposed_action` `open_adr_pr` que abriu a ADR.',
  })
  actionId!: string;

  @ApiProperty({ example: '0007 — Fila no Postgres em vez de Redis' })
  title!: string;

  @ApiProperty({ example: 'executed' })
  status!: string;

  @ApiProperty({
    example: 'https://github.com/daneiel/brabo/pull/42',
    nullable: true,
    description: '`null` enquanto a PR não foi aberta de fato.',
  })
  pullRequestUrl!: string | null;
}
export const _chavesAdrRef: MesmasChaves<AdrRefResponseDto, AdrRef> = true;

export class ArchitecturePendencyResponseDto implements Wire<ArchitecturePendency> {
  @ApiProperty({ example: '01JC4Z0000HISTORIA000000001' })
  storyId!: string;

  @ApiProperty({ example: 'Adicionar item ao carrinho' })
  title!: string;

  @ApiProperty({ example: 'ready' })
  status!: string;

  @ApiProperty({
    enum: ['no_module', 'missing_module'],
    example: 'missing_module',
    description:
      '`no_module`: a história não aponta módulo nenhum. `missing_module`: aponta ' +
      'um que não existe no mapa vigente.',
  })
  reason!: Wire<ArchitecturePendency>['reason'];

  @ApiProperty({
    example: ['pagamentos'],
    description:
      'Os módulos citados que não existem. Vazio quando `no_module`.',
  })
  missing!: string[];
}
export const _chavesPendencia: MesmasChaves<
  ArchitecturePendencyResponseDto,
  ArchitecturePendency
> = true;

export class C4AtorResponseDto implements Wire<C4Ator> {
  @ApiProperty({ example: 'Usuário' })
  name!: string;

  @ApiProperty({
    enum: TIPOS_DE_ATOR_C4 as unknown as string[],
    example: 'person',
  })
  type!: Wire<C4Ator>['type'];

  @ApiProperty({ example: 'Quem opera o produto pela web.' })
  description!: string;
}
export const _chavesC4Ator: MesmasChaves<C4AtorResponseDto, C4Ator> = true;

export class C4DiagramaResponseDto implements Wire<C4Diagrama> {
  @ApiProperty({ example: 'Brabo' })
  systemName!: string;

  @ApiProperty({ example: 'Plataforma de engenharia orquestrada por agentes.' })
  systemDescription!: string;

  @ApiProperty({ type: [C4AtorResponseDto] })
  actors!: C4AtorResponseDto[];

  @ApiProperty({
    example: 'C4Context\n  title Diagrama de Contexto -- Brabo\n  ...',
    description:
      'Sintaxe Mermaid `C4Context` — o sistema e os atores externos.',
  })
  contextDiagram!: string;

  @ApiProperty({
    example: 'C4Container\n  title Diagrama de Container -- Brabo\n  ...',
    description:
      'Sintaxe Mermaid `C4Container` — os módulos do module_map vigente e as ' +
      'dependências entre eles.',
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
      '`sem_diagrama` é o estado inicial: o Arquiteto ainda não gerou nenhum.',
  })
  status!: 'sem_diagrama' | 'gerado';

  @ApiProperty({
    type: C4DiagramaResponseDto,
    nullable: true,
    description: 'O diagrama vigente, ou `null` enquanto não há nenhum.',
  })
  diagrama!: C4DiagramaResponseDto | null;

  @ApiProperty({
    example: 0,
    description:
      'Versão do artefato vigente; 0 quando não há diagrama. Revisar é gerar ' +
      'de novo — o histórico não é reescrito.',
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

/** A seção de arquitetura: mapa vigente, ADRs, o que não fecha e o diagrama C4. */
export class ArchitectureResponseDto implements Wire<Architecture> {
  @ApiProperty({
    type: ModuleMapResponseDto,
    nullable: true,
    description: '`null` enquanto o Arquiteto não escreveu o primeiro mapa.',
  })
  moduleMap!: ModuleMapResponseDto | null;

  @ApiProperty({ type: [AdrRefResponseDto] })
  adrs!: AdrRefResponseDto[];

  @ApiProperty({
    type: [ArchitecturePendencyResponseDto],
    description:
      'Validação cruzada história↔mapa. Lista vazia é o estado saudável.',
  })
  pendencies!: ArchitecturePendencyResponseDto[];

  @ApiProperty({ type: EstadoDoC4DiagramaResponseDto })
  c4Diagram!: EstadoDoC4DiagramaResponseDto;
}
export const _chavesArquitetura: MesmasChaves<
  ArchitectureResponseDto,
  Architecture
> = true;

/** Resposta de `POST .../c4-diagram`: o diagrama recém-gerado + a versão. */
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

export class InfraArtifactResponseDto implements Wire<InfraArtifact> {
  @ApiProperty({ example: '01JC4Z0000INFRAARTEFATO00001' })
  id!: string;

  @ApiProperty({ example: EXEMPLO_PROJETO })
  projectId!: string;

  @ApiProperty({ example: EXEMPLO_SESSAO })
  sessionId!: string;

  @ApiProperty({ example: 'Dockerfile de produção da api' })
  title!: string;

  @ApiProperty({
    example: '01JC4Z8QK3M7YV2N5T9B0PXHRD',
    description:
      'Id da `proposed_action` `open_infra_pr` que abriu a PR. É o que o engine ' +
      'conhece de volta — não existe id de artefato à parte.',
  })
  prActionId!: string;

  @ApiProperty({
    enum: PR_GATE_STATUSES,
    example: 'awaiting_qa',
    description: 'Passa pelos MESMOS gates de QA e SecOps das PRs de dev.',
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
