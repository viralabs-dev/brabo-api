import { ApiProperty } from '@nestjs/swagger';
import type { GitProviderName } from '@brabo/shared';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';

const GIT_PROVIDER_NAMES: readonly GitProviderName[] = [
  'local',
  'github',
  'gitlab',
];
import { PR_GATE_STATUSES } from '../../../../domain/execution/pr-gate-state-machine';
import {
  ModuleMapResponseDto,
  StoryResponseDto,
  TaskResponseDto,
} from '../../backlog/dto/backlog.response.dto';
import { InfraArtifactResponseDto } from '../../backlog/dto/backlog.response.dto';
import { HypothesisResponseDto } from '../../psychologist/dto/psychologist.response.dto';
import type {
  DevContextAdr,
  DevContextBusinessRule,
  DevTaskContext,
} from '../../../../application/use-cases/execution/get-dev-task-context.use-case';
import type {
  InfraContext,
  InfraContextAdr,
} from '../../../../application/use-cases/execution/get-infra-context.use-case';
import type {
  PsychologistContext,
  PsychologistContextBusinessRule,
  PsychologistContextPriorHypothesis,
} from '../../../../application/use-cases/execution/get-psychologist-context.use-case';
import type {
  AnamneseContext,
  AnamneseContextDecision,
  AnamneseContextInstruction,
  AnamneseContextMember,
  AnamneseContextProfile,
  AnamneseContextQueued,
} from '../../../../application/use-cases/anamnese/get-anamnese-context.use-case';
import type { RunLlmTurnResult } from '../../../../application/use-cases/llm/run-llm-turn.use-case';
import type { ProposeHypothesesResult } from '../../../../application/use-cases/execution/propose-hypotheses.use-case';
import type { RecordGateVerdictResult } from '../../../../application/use-cases/execution/record-gate-verdict.use-case';
import type { RecordInfraGateVerdictResult } from '../../../../application/use-cases/execution/record-infra-gate-verdict.use-case';
import type { Delegation } from '../../../../domain/agents/delegation.entity';
import {
  FAILURE_ORIGINS,
  type FailureOrigin,
} from '../../../../domain/agents/failure-origin';
import type {
  InfraPrFile,
  InfraPrFiles,
} from '../../../../application/use-cases/execution/get-infra-pr-files.use-case';
import type {
  BusinessRuleWithCoverage,
  ProjectBusinessRules,
} from '../../../../application/use-cases/backlog/list-business-rules.use-case';

/**
 * Respostas da superfície interna api ↔ engine (Fase 7b, item 6).
 *
 * Estas rotas não têm usuário: quem chama é o engine, com o service token.
 * Elas entram na referência gerada assim mesmo, porque o contrato interno é
 * onde a divergência entre as duas pontas custa mais caro — o
 * `engine_api_client.ex` é o arquivo mais alterado do engine e não há
 * checagem automática de que ele bate com as rotas daqui.
 *
 * As rotas de CONTEXTO seguem todas o mesmo desenho: uma chamada devolve tudo
 * o que o agente precisa para montar o prompt, em vez de o engine fazer cinco
 * consultas. É por isso que os objetos são grandes.
 */

const GATE_NEXT_ACTIONS = ['correct', 'run_secops', 'done', 'blocked'] as const;

// ---------------------------------------------------------------- dev context

export class DevContextBusinessRuleResponseDto implements Wire<DevContextBusinessRule> {
  @ApiProperty({ example: 'Cart accepts at most 50 items' })
  title!: string;

  @ApiProperty({ example: 'Above that, the addition is refused with 409.' })
  description!: string;
}
export const _chavesRegraDev: MesmasChaves<
  DevContextBusinessRuleResponseDto,
  DevContextBusinessRule
> = true;

export class DevContextAdrResponseDto implements Wire<DevContextAdr> {
  @ApiProperty({ example: '0007 — Postgres queue instead of Redis' })
  title!: string;

  @ApiProperty({ example: '## Context\n\n…' })
  content!: string;

  @ApiProperty({
    example: false,
    description:
      "Flagged by the Architect. Becomes an informative checklist in SecOps's " +
      "verdict — there's no line-by-line correlation, and claiming there were " +
      'would misrepresent the depth of the check.',
  })
  securityRelevant!: boolean;
}
export const _chavesAdrDev: MesmasChaves<
  DevContextAdrResponseDto,
  DevContextAdr
> = true;

export class DevTaskContextResponseDto implements Wire<DevTaskContext> {
  @ApiProperty({ type: TaskResponseDto })
  task!: TaskResponseDto;

  @ApiProperty({ type: StoryResponseDto })
  story!: StoryResponseDto;

  @ApiProperty({ type: [DevContextBusinessRuleResponseDto] })
  businessRules!: DevContextBusinessRuleResponseDto[];

  @ApiProperty({
    type: [DevContextAdrResponseDto],
    description:
      'ADRs that apply: the cross-cutting ones (no module declared) plus the ' +
      "ones that cite this agent's module.",
  })
  adrs!: DevContextAdrResponseDto[];
}
export const _chavesCtxDev: MesmasChaves<
  DevTaskContextResponseDto,
  DevTaskContext
> = true;

// -------------------------------------------------------------- infra context

export class InfraContextAdrResponseDto implements Wire<InfraContextAdr> {
  @ApiProperty({ example: '0025 — Kubernetes deploy with Kustomize' })
  title!: string;

  @ApiProperty({ example: '## Context\n\n…' })
  content!: string;
}
export const _chavesAdrInfra: MesmasChaves<
  InfraContextAdrResponseDto,
  InfraContextAdr
> = true;

export class InfraContextResponseDto implements Wire<InfraContext> {
  @ApiProperty({ type: ModuleMapResponseDto, nullable: true })
  moduleMap!: ModuleMapResponseDto | null;

  @ApiProperty({ type: [InfraContextAdrResponseDto] })
  adrs!: InfraContextAdrResponseDto[];

  @ApiProperty({
    enum: GIT_PROVIDER_NAMES,
    nullable: true,
    example: 'github',
    description:
      "null when the project hasn't provisioned a repository yet. The " +
      'Workflows subagent (Phase 8c) decides the CI pipeline format from ' +
      'this: "gitlab" generates .gitlab-ci.yml, any other value generates ' +
      'GitHub Actions.',
  })
  gitProvider!: GitProviderName | null;
}
export const _chavesCtxInfra: MesmasChaves<
  InfraContextResponseDto,
  InfraContext
> = true;

// ----------------------------------------------------------- psychologist context

export class PsychologistContextBusinessRuleResponseDto implements Wire<PsychologistContextBusinessRule> {
  @ApiProperty({ example: 'RN-014' })
  id!: string;

  @ApiProperty({ example: 'Cart accepts at most 50 items' })
  title!: string;
}
export const _chavesRegraPsi: MesmasChaves<
  PsychologistContextBusinessRuleResponseDto,
  PsychologistContextBusinessRule
> = true;

export class PriorHypothesisResponseDto implements Wire<PsychologistContextPriorHypothesis> {
  @ApiProperty({ example: 'dev-api' })
  agenteAlvo!: string;

  @ApiProperty({
    example: "The instructions don't say when the task is done.",
  })
  hipotese!: string;

  @ApiProperty({ example: 'Add an explicit definition-of-done criterion.' })
  sugestao!: string;

  @ApiProperty({ example: 72 })
  confiancaPercent!: number;
}
export const _chavesHipoteseAnterior: MesmasChaves<
  PriorHypothesisResponseDto,
  PsychologistContextPriorHypothesis
> = true;

export class PsychologistContextResponseDto implements Wire<PsychologistContext> {
  @ApiProperty({
    example: false,
    description:
      'A CURRENT analysis already exists for this session. This is what makes ' +
      'the automatic path idempotent: with `true` the worker short-circuits ' +
      'without spending anything.',
  })
  alreadyAnalyzed!: boolean;

  @ApiProperty({
    enum: ['created', 'active', 'closing', 'closed', 'closed_abnormally'],
    example: 'closed_abnormally',
  })
  sessionStatus!: Wire<PsychologistContext>['sessionStatus'];

  @ApiProperty({ example: 'heartbeat_timeout', nullable: true })
  terminationReason!: string | null;

  @ApiProperty({ type: [PsychologistContextBusinessRuleResponseDto] })
  businessRules!: PsychologistContextBusinessRuleResponseDto[];

  @ApiProperty({
    type: [PriorHypothesisResponseDto],
    description: "What was already proposed before, so the round doesn't repeat itself.",
  })
  priorHypotheses!: PriorHypothesisResponseDto[];
}
export const _chavesCtxPsi: MesmasChaves<
  PsychologistContextResponseDto,
  PsychologistContext
> = true;

// ------------------------------------------------------------ anamnese context

export class AnamneseMemberResponseDto implements Wire<AnamneseContextMember> {
  @ApiProperty({ example: '01JC4Z0000USUARIO0000000002' })
  userId!: string;

  @ApiProperty({ example: 'Senior Dev', nullable: true })
  name!: string | null;

  @ApiProperty({ example: 'dev@brabo.dev' })
  email!: string;

  @ApiProperty({ example: 'developer' })
  role!: string;
}
export const _chavesMembroAnamnese: MesmasChaves<
  AnamneseMemberResponseDto,
  AnamneseContextMember
> = true;

export class AnamneseQueuedResponseDto implements Wire<AnamneseContextQueued> {
  @ApiProperty({ example: '01JC4Z0000FILA00000000000001' })
  queueId!: string;

  @ApiProperty({ example: '01JC4Z0000HIPOTESE000000001' })
  hypothesisId!: string;

  @ApiProperty({ example: 'dev-api' })
  agenteAlvo!: string;

  @ApiProperty({
    example: "The instructions don't say when the task is done.",
  })
  hipotese!: string;

  @ApiProperty({ example: 'Add an explicit definition-of-done criterion.' })
  sugestao!: string;

  @ApiProperty({ example: 72 })
  confiancaPercent!: number;
}
export const _chavesFilaAnamnese: MesmasChaves<
  AnamneseQueuedResponseDto,
  AnamneseContextQueued
> = true;

export class AnamneseProfileResponseDto implements Wire<AnamneseContextProfile> {
  @ApiProperty({ example: '01JC4Z0000USUARIO0000000002' })
  userId!: string;

  @ApiProperty({ example: 'TypeScript' })
  competency!: string;

  @ApiProperty({ example: 'advanced' })
  level!: string;

  @ApiProperty({
    example: 'Fixed three generic typing errors without help.',
  })
  rationale!: string;
}
export const _chavesPerfilAnamnese: MesmasChaves<
  AnamneseProfileResponseDto,
  AnamneseContextProfile
> = true;

export class AnamneseDecisionResponseDto implements Wire<AnamneseContextDecision> {
  @ApiProperty({ example: 'terminal' })
  actionType!: string;

  @ApiProperty({ example: 'denied' })
  status!: string;

  @ApiProperty({ example: 'Command would delete the directory.', nullable: true })
  rejectionReason!: string | null;

  @ApiProperty({ example: '01JC4Z0000USUARIO0000000001', nullable: true })
  decidedBy!: string | null;

  @ApiProperty({ example: '2026-07-27T13:00:00.000Z', nullable: true })
  decidedAt!: string | null;
}
export const _chavesDecisaoAnamnese: MesmasChaves<
  AnamneseDecisionResponseDto,
  AnamneseContextDecision
> = true;

export class AnamneseInstructionResponseDto implements Wire<AnamneseContextInstruction> {
  @ApiProperty({ example: 'dev-api' })
  agent!: string;

  @ApiProperty({ example: 4 })
  version!: number;

  @ApiProperty({ example: '# dev-api\n\n…' })
  content!: string;
}
export const _chavesInstrucaoAnamnese: MesmasChaves<
  AnamneseInstructionResponseDto,
  AnamneseContextInstruction
> = true;

export class AnamneseContextResponseDto implements Wire<AnamneseContext> {
  @ApiProperty({
    example: ['TypeScript', 'Elixir', 'Kubernetes'],
    description:
      "CLOSED catalog. The model cannot emit a competency outside of this — " +
      'validation rejects it — so it goes into the prompt as a list.',
  })
  competencyCatalog!: string[];

  @ApiProperty({
    type: [AnamneseMemberResponseDto],
    description: 'Already EXCLUDES whoever opted out of being profiled.',
  })
  members!: AnamneseMemberResponseDto[];

  @ApiProperty({
    type: [AnamneseQueuedResponseDto],
    description:
      "The Psychologist's ACCEPTED hypotheses waiting to become prioritized input.",
  })
  queuedHypotheses!: AnamneseQueuedResponseDto[];

  @ApiProperty({ type: [AnamneseProfileResponseDto] })
  currentProfiles!: AnamneseProfileResponseDto[];

  @ApiProperty({ type: [AnamneseInstructionResponseDto] })
  instructions!: AnamneseInstructionResponseDto[];

  @ApiProperty({
    type: [AnamneseDecisionResponseDto],
    description:
      "The user's approvals and denials within the window. They come through " +
      'here because they are NOT in the event log.',
  })
  decisions!: AnamneseDecisionResponseDto[];

  @ApiProperty({
    example: '2026-07-27T12:00:00.000Z',
    nullable: true,
    description:
      'Start of the window to analyze (end of the last round). `null` on the ' +
      'first one. The engine reads the events themselves straight from ' +
      "Postgres — carrying them over HTTP would be more expensive without " +
      'being more correct.',
  })
  windowFrom!: string | null;
}
export const _chavesCtxAnamnese: MesmasChaves<
  AnamneseContextResponseDto,
  AnamneseContext
> = true;

// -------------------------------------------------------------------- LLM turn

export class ToolCallResponseDto {
  @ApiProperty({ example: 'call_01' })
  id!: string;

  @ApiProperty({ example: 'read_file' })
  name!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { path: 'src/index.ts' },
    description:
      'Already deserialized; the engine dispatches to the tool by `name`.',
  })
  arguments!: Record<string, unknown>;
}

export class LlmMessageResponseDto {
  @ApiProperty({ example: 'assistant', enum: ['assistant'] })
  role!: 'assistant';

  @ApiProperty({ example: "I'll read the file before answering." })
  content!: string;

  @ApiProperty({ type: [ToolCallResponseDto] })
  toolCalls!: ToolCallResponseDto[];
}

export class LlmUsageResponseDto {
  @ApiProperty({ example: 1820 })
  inputTokens!: number;

  @ApiProperty({ example: 340 })
  outputTokens!: number;

  @ApiProperty({ example: 52700, description: 'Cost in micro-USD.' })
  costMicros!: number;

  @ApiProperty({
    example: false,
    description:
      '`true` when the provider did not return a count and the cost was ' +
      'ESTIMATED. The number is worth less, and whoever consumes it needs to ' +
      'be able to say so.',
  })
  estimated!: boolean;
}

export class LlmTurnResponseDto implements Wire<RunLlmTurnResult> {
  @ApiProperty({ type: LlmMessageResponseDto })
  message!: LlmMessageResponseDto;

  @ApiProperty({ type: LlmUsageResponseDto })
  usage!: LlmUsageResponseDto;

  @ApiProperty({
    example: null,
    nullable: true,
    description:
      "The provider's failure. Comes in the BODY with 200, not as an HTTP " +
      "error, because the accounting in `usage` remains valid — the turn " +
      'spent, even while failing.',
  })
  error!: string | null;

  @ApiProperty({
    example: 'llama3.2:3b',
    nullable: true,
    description:
      'Name of the model that generated the response (finding from problem 2) ' +
      '— `null` when the turn failed before resolving a model (no binding, ' +
      'or binding to a non-existent model).',
  })
  modelName!: string | null;
}
export const _chavesTurno: MesmasChaves<LlmTurnResponseDto, RunLlmTurnResult> =
  true;

/** A frame of the LLM turn stream (`llm-turn-stream`). */
export class LlmTurnStreamEventResponseDto {
  @ApiProperty({
    enum: ['delta', 'done', 'error'],
    example: 'delta',
    description:
      '`delta` carries `text`; `done` closes with `usage`; `error` carries `message`.',
  })
  type!: 'delta' | 'done' | 'error';

  @ApiProperty({ example: "I'll read the", required: false })
  text?: string;

  @ApiProperty({ type: LlmUsageResponseDto, required: false })
  usage?: LlmUsageResponseDto;

  @ApiProperty({ example: 'provider unavailable', required: false })
  message?: string;

  @ApiProperty({
    example: 'llama3.2:3b',
    required: false,
    nullable: true,
    description:
      'Only on the `done`/`final` frame — name of the model that generated ' +
      'the response (finding from problem 2). `null` when the turn failed ' +
      'before resolving a model.',
  })
  modelName?: string | null;
}

// ------------------------------------------------------------------------- gates

export class GateVerdictResponseDto implements Wire<RecordGateVerdictResult> {
  @ApiProperty({
    enum: GATE_NEXT_ACTIONS,
    example: 'run_secops',
    description:
      "What happens next. `correct` returns to dev; `run_secops` advances " +
      'the gate; `done` releases it to the user; `blocked` means the ' +
      'correction cap ran out and only a human can unblock it.',
  })
  nextAction!: Wire<RecordGateVerdictResult>['nextAction'];

  @ApiProperty({ type: TaskResponseDto })
  task!: TaskResponseDto;
}
export const _chavesGate: MesmasChaves<
  GateVerdictResponseDto,
  RecordGateVerdictResult
> = true;

export class InfraGateVerdictResponseDto implements Wire<RecordInfraGateVerdictResult> {
  @ApiProperty({ enum: GATE_NEXT_ACTIONS, example: 'done' })
  nextAction!: Wire<RecordInfraGateVerdictResult>['nextAction'];

  @ApiProperty({ type: InfraArtifactResponseDto })
  artifact!: InfraArtifactResponseDto;
}
export const _chavesGateInfra: MesmasChaves<
  InfraGateVerdictResponseDto,
  RecordInfraGateVerdictResult
> = true;

export class InfraPrFileResponseDto implements Wire<InfraPrFile> {
  @ApiProperty({ example: 'docker/api/Dockerfile.prod' })
  path!: string;

  @ApiProperty({ example: 'FROM node:24.11.1-alpine3.21 AS build\n…' })
  content!: string;
}
export const _chavesArquivoPr: MesmasChaves<
  InfraPrFileResponseDto,
  InfraPrFile
> = true;

export class InfraPrFilesResponseDto implements Wire<InfraPrFiles> {
  @ApiProperty({ example: "api's production Dockerfile" })
  title!: string;

  @ApiProperty({
    type: [InfraPrFileResponseDto],
    description:
      "The content comes from the `proposed_action`'s own payload: an infra " +
      'artifact NEVER touches a worktree, same as ADRs.',
  })
  files!: InfraPrFileResponseDto[];
}
export const _chavesArquivosPr: MesmasChaves<
  InfraPrFilesResponseDto,
  InfraPrFiles
> = true;

// -------------------------------------------------------------- hypotheses and profiles

export class ProposeHypothesesResponseDto implements Wire<ProposeHypothesesResult> {
  @ApiProperty({
    example: '01JC4Z0000ANALISE0000000001',
    description: "The created round. This session's previous one becomes superseded.",
  })
  analysisId!: string;

  @ApiProperty({ type: [HypothesisResponseDto] })
  hypotheses!: HypothesisResponseDto[];
}
export const _chavesPropoeHipoteses: MesmasChaves<
  ProposeHypothesesResponseDto,
  ProposeHypothesesResult
> = true;

export class RecordProficiencyResponseDto {
  @ApiProperty({ example: '01JC4Z0000RODADA00000000001' })
  runId!: string;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'The profiles recorded in this round.',
  })
  profiles!: unknown[];
}

/** A gate stage, as opened by the engine. */
export class GateAbertoResponseDto {
  @ApiProperty({ enum: PR_GATE_STATUSES, example: 'awaiting_qa' })
  gateStatus!: (typeof PR_GATE_STATUSES)[number];
}

const DELEGATION_STATUSES = ['completed', 'failed', 'dispensed'] as const;

/** A QA area delegation, as recorded (Phase 8b, ADR 0038). */
export class DelegationResponseDto implements Wire<Delegation> {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000DELEGACAO00000001' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  projectId!: string;

  @ApiProperty({ format: 'uuid', example: '01JC4Z0000SESSAO000000000001' })
  sessionId!: string;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    example: '01JC4Z0000TAREFA00000000001',
    description:
      "null when the area has no backlog task behind it (Infra, Phase 8c).",
  })
  taskId!: string | null;

  @ApiProperty({ example: 'qa' })
  area!: string;

  @ApiProperty({ example: 'qa-lead' })
  leadAgent!: string;

  @ApiProperty({ example: 'qa-automacao' })
  subagent!: string;

  @ApiProperty({ enum: DELEGATION_STATUSES, example: 'completed' })
  status!: (typeof DELEGATION_STATUSES)[number];

  @ApiProperty({ nullable: true, example: 'evt_01jc4z0000parecer000000001' })
  parecerArtifactId!: string | null;

  @ApiProperty({ enum: FAILURE_ORIGINS, nullable: true, example: null })
  failureOrigin!: FailureOrigin | null;

  @ApiProperty({ nullable: true, example: null })
  failureReason!: string | null;

  @ApiProperty({ nullable: true, example: null })
  justification!: string | null;

  @ApiProperty({ example: '2026-07-30T12:00:00.000Z' })
  createdAt!: string;
}
export const _chavesDelegation: MesmasChaves<
  DelegationResponseDto,
  Delegation
> = true;

// ------------------------------------------------------- PO reading (RN-164)

export class ProjectBusinessRuleResponseDto implements Wire<BusinessRuleWithCoverage> {
  @ApiProperty({
    example: 'evt_01jc4z0000regra0000000001',
    description:
      "The `artifact.business_rule` EVENT's id. This is the value that goes " +
      'into `business_rule_ids` when creating the story — there is no rules table.',
  })
  id!: string;

  @ApiProperty({ example: 'Cart accepts at most 50 items' })
  title!: string;

  @ApiProperty({
    example: 'Above that, the addition is refused with 409.',
    description:
      "The rule's content, not just the statement: the story's requirement " +
      'comes from it. This is the field that distinguishes this reading from ' +
      "the screen's coverage.",
  })
  description!: string;

  @ApiProperty({
    type: [String],
    example: ['01JC4Z0000HISTORIA000000001'],
    description: 'Stories that already cite this rule.',
  })
  coveredByStoryIds!: string[];

  @ApiProperty({ example: true })
  covered!: boolean;
}
export const _chavesRegraDoProjeto: MesmasChaves<
  ProjectBusinessRuleResponseDto,
  BusinessRuleWithCoverage
> = true;

export class ProjectBusinessRulesResponseDto implements Wire<ProjectBusinessRules> {
  @ApiProperty({ type: [ProjectBusinessRuleResponseDto] })
  rules!: ProjectBusinessRuleResponseDto[];

  @ApiProperty({
    example: 2,
    description:
      "How many rules no story covers. This is the PO's pending item, and " +
      'the number that the `listar_regras_de_negocio` tool puts in front of ' +
      'the model.',
  })
  uncoveredCount!: number;
}
export const _chavesRegrasDoProjeto: MesmasChaves<
  ProjectBusinessRulesResponseDto,
  ProjectBusinessRules
> = true;
