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

// ---------------------------------------------------------------- contexto do dev

export class DevContextBusinessRuleResponseDto implements Wire<DevContextBusinessRule> {
  @ApiProperty({ example: 'Carrinho aceita no máximo 50 itens' })
  title!: string;

  @ApiProperty({ example: 'Acima disso, a adição é recusada com 409.' })
  description!: string;
}
export const _chavesRegraDev: MesmasChaves<
  DevContextBusinessRuleResponseDto,
  DevContextBusinessRule
> = true;

export class DevContextAdrResponseDto implements Wire<DevContextAdr> {
  @ApiProperty({ example: '0007 — Fila no Postgres em vez de Redis' })
  title!: string;

  @ApiProperty({ example: '## Contexto\n\n…' })
  content!: string;

  @ApiProperty({
    example: false,
    description:
      'Marcado pelo Arquiteto. Vira checklist informativo no parecer do SecOps — ' +
      'não há correlação linha a linha, e afirmar que haveria seria mentir sobre a ' +
      'profundidade da checagem.',
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
      'ADRs que se aplicam: as transversais (sem módulo declarado) mais as que citam ' +
      'o módulo deste agente.',
  })
  adrs!: DevContextAdrResponseDto[];
}
export const _chavesCtxDev: MesmasChaves<
  DevTaskContextResponseDto,
  DevTaskContext
> = true;

// -------------------------------------------------------------- contexto da infra

export class InfraContextAdrResponseDto implements Wire<InfraContextAdr> {
  @ApiProperty({ example: '0025 — Deploy Kubernetes com Kustomize' })
  title!: string;

  @ApiProperty({ example: '## Contexto\n\n…' })
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
      'null quando o projeto ainda não provisionou repositório. O subagente Workflows ' +
      '(Fase 8c) decide o formato do pipeline de CI por isto: "gitlab" gera .gitlab-ci.yml, ' +
      'qualquer outro valor gera GitHub Actions.',
  })
  gitProvider!: GitProviderName | null;
}
export const _chavesCtxInfra: MesmasChaves<
  InfraContextResponseDto,
  InfraContext
> = true;

// ----------------------------------------------------------- contexto do psicólogo

export class PsychologistContextBusinessRuleResponseDto implements Wire<PsychologistContextBusinessRule> {
  @ApiProperty({ example: 'RN-014' })
  id!: string;

  @ApiProperty({ example: 'Carrinho aceita no máximo 50 itens' })
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
    example: 'As instruções não dizem quando a tarefa está pronta.',
  })
  hipotese!: string;

  @ApiProperty({ example: 'Acrescentar um critério de pronto explícito.' })
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
      'Já existe análise CURRENT para esta sessão. É o que dá idempotência ao ' +
      'caminho automático: com `true` o worker curto-circuita sem gastar nada.',
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
    description:
      'O que já foi proposto antes, para a rodada não repetir a si mesma.',
  })
  priorHypotheses!: PriorHypothesisResponseDto[];
}
export const _chavesCtxPsi: MesmasChaves<
  PsychologistContextResponseDto,
  PsychologistContext
> = true;

// ------------------------------------------------------------ contexto da anamnese

export class AnamneseMemberResponseDto implements Wire<AnamneseContextMember> {
  @ApiProperty({ example: '01JC4Z0000USUARIO0000000002' })
  userId!: string;

  @ApiProperty({ example: 'Dev Sênior', nullable: true })
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
    example: 'As instruções não dizem quando a tarefa está pronta.',
  })
  hipotese!: string;

  @ApiProperty({ example: 'Acrescentar um critério de pronto explícito.' })
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

  @ApiProperty({ example: 'avancado' })
  level!: string;

  @ApiProperty({
    example: 'Corrigiu três erros de tipagem genérica sem ajuda.',
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

  @ApiProperty({ example: 'Comando apagaria o diretório.', nullable: true })
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
      'Catálogo FECHADO. O modelo não pode emitir competência fora daqui — a ' +
      'validação rejeita —, então ele vai no prompt como lista.',
  })
  competencyCatalog!: string[];

  @ApiProperty({
    type: [AnamneseMemberResponseDto],
    description: 'Já EXCLUI quem optou por não ser perfilado.',
  })
  members!: AnamneseMemberResponseDto[];

  @ApiProperty({
    type: [AnamneseQueuedResponseDto],
    description:
      'Hipóteses ACEITAS do Psicólogo esperando virar input priorizado.',
  })
  queuedHypotheses!: AnamneseQueuedResponseDto[];

  @ApiProperty({ type: [AnamneseProfileResponseDto] })
  currentProfiles!: AnamneseProfileResponseDto[];

  @ApiProperty({ type: [AnamneseInstructionResponseDto] })
  instructions!: AnamneseInstructionResponseDto[];

  @ApiProperty({
    type: [AnamneseDecisionResponseDto],
    description:
      'Aprovações e negações do usuário dentro da janela. Vêm por aqui porque NÃO ' +
      'estão no event log.',
  })
  decisions!: AnamneseDecisionResponseDto[];

  @ApiProperty({
    example: '2026-07-27T12:00:00.000Z',
    nullable: true,
    description:
      'Início da janela a analisar (fim da última rodada). `null` na primeira. Os ' +
      'eventos em si o engine lê direto do Postgres — trafegá-los por HTTP seria ' +
      'mais caro sem ser mais correto.',
  })
  windowFrom!: string | null;
}
export const _chavesCtxAnamnese: MesmasChaves<
  AnamneseContextResponseDto,
  AnamneseContext
> = true;

// -------------------------------------------------------------------- turno de LLM

export class ToolCallResponseDto {
  @ApiProperty({ example: 'call_01' })
  id!: string;

  @ApiProperty({ example: 'ler_arquivo' })
  name!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { path: 'src/index.ts' },
    description:
      'Já desserializado; o engine despacha para a ferramenta por `name`.',
  })
  arguments!: Record<string, unknown>;
}

export class LlmMessageResponseDto {
  @ApiProperty({ example: 'assistant', enum: ['assistant'] })
  role!: 'assistant';

  @ApiProperty({ example: 'Vou ler o arquivo antes de responder.' })
  content!: string;

  @ApiProperty({ type: [ToolCallResponseDto] })
  toolCalls!: ToolCallResponseDto[];
}

export class LlmUsageResponseDto {
  @ApiProperty({ example: 1820 })
  inputTokens!: number;

  @ApiProperty({ example: 340 })
  outputTokens!: number;

  @ApiProperty({ example: 52700, description: 'Custo em micro-USD.' })
  costMicros!: number;

  @ApiProperty({
    example: false,
    description:
      '`true` quando o provider não devolveu contagem e o custo foi ESTIMADO. O ' +
      'número vale menos, e quem consome precisa poder dizer isso.',
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
      'Falha do provider. Vem no CORPO com 200, e não como erro HTTP, porque a ' +
      'contabilidade em `usage` continua válida — o turno gastou, mesmo falhando.',
  })
  error!: string | null;
}
export const _chavesTurno: MesmasChaves<LlmTurnResponseDto, RunLlmTurnResult> =
  true;

/** Um quadro do stream de turno de LLM (`llm-turn-stream`). */
export class LlmTurnStreamEventResponseDto {
  @ApiProperty({
    enum: ['delta', 'done', 'error'],
    example: 'delta',
    description:
      '`delta` traz `text`; `done` fecha com `usage`; `error` traz `message`.',
  })
  type!: 'delta' | 'done' | 'error';

  @ApiProperty({ example: 'Vou ler o', required: false })
  text?: string;

  @ApiProperty({ type: LlmUsageResponseDto, required: false })
  usage?: LlmUsageResponseDto;

  @ApiProperty({ example: 'provider indisponível', required: false })
  message?: string;
}

// ------------------------------------------------------------------------- gates

export class GateVerdictResponseDto implements Wire<RecordGateVerdictResult> {
  @ApiProperty({
    enum: GATE_NEXT_ACTIONS,
    example: 'run_secops',
    description:
      'O que acontece a seguir. `correct` devolve ao dev; `run_secops` avança o ' +
      'gate; `done` libera para o usuário; `blocked` significa que o teto de ' +
      'correções estourou e só um humano destrava.',
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
  @ApiProperty({ example: 'Dockerfile de produção da api' })
  title!: string;

  @ApiProperty({
    type: [InfraPrFileResponseDto],
    description:
      'O conteúdo vem do payload da própria `proposed_action`: artefato de infra ' +
      'NUNCA toca um worktree, igual às ADRs.',
  })
  files!: InfraPrFileResponseDto[];
}
export const _chavesArquivosPr: MesmasChaves<
  InfraPrFilesResponseDto,
  InfraPrFiles
> = true;

// -------------------------------------------------------------- hipóteses e perfis

export class ProposeHypothesesResponseDto implements Wire<ProposeHypothesesResult> {
  @ApiProperty({
    example: '01JC4Z0000ANALISE0000000001',
    description: 'A rodada criada. A anterior desta sessão vira superseded.',
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
    description: 'Os perfis gravados nesta rodada.',
  })
  profiles!: unknown[];
}

/** Um estágio do gate, como ele é aberto pelo engine. */
export class GateAbertoResponseDto {
  @ApiProperty({ enum: PR_GATE_STATUSES, example: 'awaiting_qa' })
  gateStatus!: (typeof PR_GATE_STATUSES)[number];
}

const DELEGATION_STATUSES = ['completed', 'failed', 'dispensed'] as const;

/** Uma delegação da área de QA, como registrada (Fase 8b, ADR 0038). */
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
      'null quando a área não tem task de backlog por trás (Infra, Fase 8c).',
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
