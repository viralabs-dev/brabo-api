import { ApiProperty } from '@nestjs/swagger';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import { BUDGET_POLICIES } from '../../../../domain/llm/budget-threshold';
import { MODEL_BINDING_SCOPES } from '../../../../domain/llm/model-binding-scope';
import {
  MODEL_AVAILABILITIES,
  type Model,
  type ModelComCuradoria,
} from '../../../../domain/llm/model.entity';
import {
  USOS_DE_MODELO,
  type UsoDeModelo,
} from '../../../../domain/llm/model-uses';
import type { Budget } from '../../../../domain/llm/budget.entity';
import {
  PRICE_CHANGE_SOURCES,
  type ModelPriceChange,
} from '../../../../domain/llm/model-price-change.entity';
import type { ModelBinding } from '../../../../domain/llm/model-binding.entity';
import type {
  ResolvedBinding,
  SkippedBinding,
} from '../../../../domain/llm/binding-resolver';
import type { UserCredentialMetadata } from '../../../../domain/llm/user-credential.entity';
import type { AgentTokenUsage } from '../../../../application/ports/token-usage-repository.port';
import type {
  SpendLinha,
  SpendPorDia,
} from '../../../../application/use-cases/llm/spend-report';
import type { WorkspaceSpendReport } from '../../../../application/use-cases/llm/get-workspace-spend-report.use-case';
import type { MySpend } from '../../../../application/use-cases/llm/get-my-spend.use-case';

/**
 * Respostas de modelos, credenciais, bindings e orçamento (Fase 7b, item 6).
 *
 * Tudo aqui fala em **micro-USD** (milionésimos de dólar), não em float de
 * dólar. Preço de token é da ordem de 10⁻⁶ e somar float nessa escala acumula
 * erro que aparece na fatura; inteiro não.
 *
 * A única exceção é a ENTRADA de limite de orçamento, que aceita dólar por ser
 * o que uma pessoa digita — a conversão acontece no controller.
 */

export class ModelResponseDto implements Wire<Model> {
  @ApiProperty({ example: '01JC4Z0000MODELO00000000001' })
  id!: string;

  @ApiProperty({
    enum: ['ollama', 'anthropic', 'openai'],
    example: 'anthropic',
  })
  provider!: Wire<Model>['provider'];

  @ApiProperty({
    example: 'claude-opus-4-8',
    description: 'Identifier at the provider.',
  })
  name!: string;

  @ApiProperty({ example: 'Claude Opus 4.8' })
  displayName!: string;

  @ApiProperty({
    example: 15000000,
    description: 'Price per million INPUT tokens, in micro-USD.',
  })
  inputPricePerMillionMicros!: number;

  @ApiProperty({
    example: 75000000,
    description: 'Price per million OUTPUT tokens, in micro-USD.',
  })
  outputPricePerMillionMicros!: number;

  @ApiProperty({
    example: 200000,
    nullable: true,
    description: "Also the model's `context_length` capability.",
  })
  contextWindow!: number | null;

  @ApiProperty({
    example: true,
    description:
      'NATIVE tool calling. Without this the model is chat-only and cannot ' +
      'be bound to an agent (RN-040).',
  })
  supportsToolCalling!: boolean;

  @ApiProperty({ example: true })
  supportsStreaming!: boolean;

  @ApiProperty({
    example: false,
    description:
      'Accepts IMAGE input. `false` means the provider did not declare the ' +
      "modality — not that the model can't do it (ADR 0041).",
  })
  supportsVision!: boolean;

  @ApiProperty({
    example: true,
    description:
      'Accepts explicit reasoning (thinking). On OpenRouter it comes from ' +
      '`supported_parameters: reasoning`.',
  })
  supportsReasoning!: boolean;

  @ApiProperty({
    example: false,
    description:
      'PRODUCES image — an axis different from accepting it as input. Few ' +
      'models have it, and confusing the two sends the user to the wrong model.',
  })
  generatesImage!: boolean;

  @ApiProperty({
    example: true,
    description:
      "Price typed in from the provider's docs, not synced. The price sync " +
      'does not overwrite a row marked without an explicit decision.',
  })
  manualPricing!: boolean;

  @ApiProperty({
    enum: MODEL_AVAILABILITIES,
    example: 'available',
    description:
      'REMOTE reality observed by sync, an axis independent from curation. ' +
      '`unavailable` is a model that vanished from the provider catalog — it ' +
      'is never deleted, because bindings and cost history point to it.',
  })
  availability!: Wire<Model>['availability'];

  @ApiProperty({
    example: '2026-07-30T03:00:00.000Z',
    format: 'date-time',
    nullable: true,
    description: 'Last time sync saw the model in the provider catalog.',
  })
  lastSeenAt!: string | null;

  @ApiProperty({ example: '2026-07-01T00:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-01T00:00:00.000Z', format: 'date-time' })
  updatedAt!: string;
}
export const _chavesModel: MesmasChaves<ModelResponseDto, Model> = true;

/**
 * O modelo COM a curadoria de um workspace (ADR 0049).
 *
 * `isActive` está aqui e não em `ModelResponseDto` porque ele não é atributo
 * do modelo: é a decisão de um workspace sobre ele. A rota do seletor devolve
 * o DTO sem curadoria — lá a lista já É a dos ativos, e repetir o campo
 * sugeriria que ele pode vir `false`. Só a tela de curadoria e a resposta da
 * ativação usam este.
 */
export class ModelComCuradoriaResponseDto
  extends ModelResponseDto
  implements Wire<ModelComCuradoria>
{
  @ApiProperty({
    example: true,
    description:
      "Curation by the OWNER **of this workspace**: a deactivated model " +
      'disappears from the selector but stays in historical costs. A model ' +
      'discovered by sync has no curation row, and no row means `false`.',
  })
  isActive!: boolean;

  @ApiProperty({
    enum: USOS_DE_MODELO,
    isArray: true,
    example: ['codigo'],
    description:
      'What THIS workspace uses the model for. The operator\'s opinion, not ' +
      'a provider capability — no catalog publishes "good for code". An ' +
      'empty list means "nobody has an opinion", not "not fit for it".',
  })
  uses!: UsoDeModelo[];
}
export const _chavesModelComCuradoria: MesmasChaves<
  ModelComCuradoriaResponseDto,
  ModelComCuradoria
> = true;

/**
 * A projeção segura de uma credencial. **Nunca** traz o segredo — nem cifrado.
 * É o único formato de credencial que atravessa a fronteira HTTP.
 */
export class UserCredentialResponseDto implements Wire<UserCredentialMetadata> {
  @ApiProperty({ example: '01JC4Z0000CREDENCIAL00000001' })
  id!: string;

  @ApiProperty({
    example: 'anthropic',
    description: 'Covers LLM keys and git tokens (`github`, `gitlab`).',
  })
  provider!: Wire<UserCredentialMetadata>['provider'];

  @ApiProperty({ example: '2026-07-10T10:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-10T10:00:00.000Z', format: 'date-time' })
  updatedAt!: string;
}
export const _chavesCredencial: MesmasChaves<
  UserCredentialResponseDto,
  UserCredentialMetadata
> = true;

/**
 * O resultado de verificar uma credencial GRAVADA (ADR 0050). Note o que
 * NÃO está aqui: a chave, nem um pedaço dela, nem o corpo cru da resposta do
 * provider. Só o veredito e, quando há recusa, a frase de diagnóstico.
 */
export class CredentialTestResultResponseDto {
  @ApiProperty({
    enum: ['ok', 'recusado', 'nao_suportado'],
    example: 'recusado',
    description:
      '`ok` — the provider accepted the credential. `recusado` — the ' +
      'provider rejected it (invalid/revoked key, no balance, network). ' +
      '`nao_suportado` — this provider has no verified test endpoint ' +
      '(`ollama`, `anthropic`, `openai`): NOTHING was verified, and saying ' +
      '"ok" here would be a lie.',
  })
  resultado!: 'ok' | 'recusado' | 'nao_suportado';

  @ApiProperty({
    required: false,
    example:
      'connection test failed for openrouter: openrouter responded 401',
    description: 'Only on `recusado` — the reason the provider gave.',
  })
  motivo?: string;
}

export class ModelBindingResponseDto implements Wire<ModelBinding> {
  @ApiProperty({ example: '01JC4Z0000BINDING00000000001' })
  id!: string;

  @ApiProperty({ enum: MODEL_BINDING_SCOPES, example: 'project' })
  scope!: Wire<ModelBinding>['scope'];

  @ApiProperty({
    example: '01JC4Z0000PROJETO0000000001',
    description:
      'Id of the workspace, project, or session the binding is pinned to. In ' +
      'the `agent` and `area` scopes, which exist PER PROJECT, it is ' +
      'composite: `<projectId>:<agent slug|area key>` (ADR 0064).',
  })
  scopeId!: string;

  @ApiProperty({ example: '01JC4Z0000MODELO00000000001' })
  modelId!: string;

  @ApiProperty({ example: '01JC4Z0000USUARIO0000000001' })
  createdBy!: string;

  @ApiProperty({ example: '2026-07-11T09:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-11T09:00:00.000Z', format: 'date-time' })
  updatedAt!: string;
}
export const _chavesBinding: MesmasChaves<
  ModelBindingResponseDto,
  ModelBinding
> = true;

/**
 * Um escopo que a cascata PULOU (Fase 9c, RN-043). Existe para a UI conseguir
 * dizer "o modelo do agente sumiu, caiu para o do projeto" — trocar o modelo em
 * silêncio é o que a regra proíbe.
 */
export class SkippedBindingResponseDto implements Wire<SkippedBinding> {
  @ApiProperty({ enum: MODEL_BINDING_SCOPES, example: 'agent' })
  scope!: Wire<SkippedBinding>['scope'];

  @ApiProperty({ example: '01JC4Z0000MODELO00000000001' })
  modelId!: string;

  @ApiProperty({
    enum: ['unavailable', 'sem_tool_calling'],
    example: 'unavailable',
    description:
      '`unavailable`: the model vanished from the provider catalog. ' +
      '`sem_tool_calling`: the request is from an agent and the model is ' +
      'chat-only — the cascade revalidates the capability at every level so ' +
      'as not to silently violate RN-040.',
  })
  reason!: Wire<SkippedBinding>['reason'];
}
export const _chavesBindingPulado: MesmasChaves<
  SkippedBindingResponseDto,
  SkippedBinding
> = true;

/** O binding já RESOLVIDO pela cascata, com a origem do valor. */
export class ResolvedBindingResponseDto implements Wire<ResolvedBinding> {
  @ApiProperty({ example: '01JC4Z0000MODELO00000000001' })
  modelId!: string;

  @ApiProperty({
    enum: MODEL_BINDING_SCOPES,
    example: 'project',
    description:
      'Which scope the value came from. The cascade is session → agent → ' +
      'project → workspace, and exposing the ORIGIN is what lets the UI say ' +
      '"inherited from the project" instead of showing a value with no provenance.',
  })
  origin!: Wire<ResolvedBinding>['origin'];

  @ApiProperty({
    type: [SkippedBindingResponseDto],
    description:
      'More specific scopes the cascade discarded before reaching `origin`. ' +
      'Empty on the normal path.',
  })
  skipped!: SkippedBindingResponseDto[];
}
export const _chavesBindingResolvido: MesmasChaves<
  ResolvedBindingResponseDto,
  ResolvedBinding
> = true;

/**
 * Uma mudança de preço (Fase 9c, RN-044). Append-only: o par antes/depois é
 * gravado junto para a auditoria não depender de reconstruir o "antes" a
 * partir da linha anterior.
 */
export class ModelPriceChangeResponseDto implements Wire<ModelPriceChange> {
  @ApiProperty({ example: '01JC4Z0000PRECO000000000001' })
  id!: string;

  @ApiProperty({ example: '01JC4Z0000MODELO00000000001' })
  modelId!: string;

  @ApiProperty({ example: 2500000, description: 'Micro-USD per 1M, before.' })
  inputBeforeMicros!: number;

  @ApiProperty({ example: 3000000, description: 'Micro-USD per 1M, after.' })
  inputAfterMicros!: number;

  @ApiProperty({ example: 10000000 })
  outputBeforeMicros!: number;

  @ApiProperty({ example: 12000000 })
  outputAfterMicros!: number;

  @ApiProperty({
    enum: PRICE_CHANGE_SOURCES,
    example: 'manual',
    description:
      "`manual` was someone typing from the provider's docs; `sync` came " +
      'from the remote catalog.',
  })
  source!: Wire<ModelPriceChange>['source'];

  @ApiProperty({
    example: '01JC4Z0000USUARIO0000000001',
    nullable: true,
    description: '`null` when it came from sync — no person behind it.',
  })
  changedBy!: string | null;

  @ApiProperty({ example: '2026-08-01T12:00:00.000Z', format: 'date-time' })
  createdAt!: string;
}
export const _chavesMudancaDePreco: MesmasChaves<
  ModelPriceChangeResponseDto,
  ModelPriceChange
> = true;

export class BudgetResponseDto implements Wire<Budget> {
  @ApiProperty({ example: '01JC4Z0000ORCAMENTO000000001' })
  id!: string;

  @ApiProperty({
    example: '01JC4Z0000PROJETO0000000001',
    nullable: true,
    description: 'Filled in for a project budget; `null` for a session one.',
  })
  projectId!: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'The opposite of the above.',
  })
  sessionId!: string | null;

  @ApiProperty({
    example: 50000000,
    description: 'Cap in micro-USD (50 USD).',
  })
  limitMicros!: number;

  @ApiProperty({
    example: 12400000,
    description: 'Accumulated spend, in micro-USD.',
  })
  spentMicros!: number;

  @ApiProperty({
    enum: BUDGET_POLICIES,
    example: 'block',
    description:
      '`block` refuses the call when it would exceed the cap; `allow` lets ' +
      'it through and only warns.',
  })
  policy!: Wire<Budget>['policy'];

  @ApiProperty({
    example: 70,
    description:
      'Highest threshold (70/90/100) already notified. It, not the previous ' +
      'spend, serves as the floor — using the spend would make the same ' +
      'warning fire again on every call after it was crossed.',
  })
  lastThresholdNotified!: number;

  @ApiProperty({ example: '2026-07-12T08:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-27T15:00:00.000Z', format: 'date-time' })
  updatedAt!: string;
}
export const _chavesOrcamento: MesmasChaves<BudgetResponseDto, Budget> = true;

/** Quanto cada agente da sessão gastou — o que cada card do painel mostra. */
export class AgentTokenUsageResponseDto implements Wire<AgentTokenUsage> {
  @ApiProperty({
    example: 'dev-api',
    description: "The agent's slug, or the user's id.",
  })
  actorId!: string;

  @ApiProperty({ example: 3400000, description: 'Cost in micro-USD.' })
  costMicros!: number;

  @ApiProperty({ example: 128000 })
  inputTokens!: number;

  @ApiProperty({ example: 14200 })
  outputTokens!: number;
}
export const _chavesUsoPorAgente: MesmasChaves<
  AgentTokenUsageResponseDto,
  AgentTokenUsage
> = true;

/**
 * Um quadro do stream de chat.
 *
 * O SSE não devolve um corpo, devolve uma SEQUÊNCIA — e cada quadro é um
 * destes quatro. Documentar só "é um stream" deixaria de fora exatamente o
 * que o cliente precisa saber para consumi-lo.
 */
export class ChatSseEventResponseDto {
  @ApiProperty({
    enum: ['delta', 'done', 'error', 'metering_failed'],
    example: 'delta',
    description:
      '`delta` carries incremental `text`; `done` closes with the token/cost ' +
      'accounting; `error` aborts; `metering_failed` means the RESPONSE went ' +
      'out but the cost was not accounted for — the frame exists so that ' +
      'failure does not go unnoticed.',
  })
  type!: 'delta' | 'done' | 'error' | 'metering_failed';

  @ApiProperty({
    example: 'I will open the epic',
    required: false,
    description: 'Only on `delta`.',
  })
  text?: string;

  @ApiProperty({ example: 1820, required: false, description: 'Only on `done`.' })
  inputTokens?: number;

  @ApiProperty({ example: 340, required: false, description: 'Only on `done`.' })
  outputTokens?: number;

  @ApiProperty({
    example: 52700,
    required: false,
    description: 'Only on `done`, micro-USD.',
  })
  costMicros?: number;

  @ApiProperty({
    example: false,
    required: false,
    description:
      'Only on `done`. `true` when the provider did not return a count and ' +
      'the cost was ESTIMATED — the number is worth less and the UI needs to ' +
      'be able to say so.',
  })
  estimated?: boolean;

  @ApiProperty({
    example: 'session budget exhausted',
    required: false,
    description: 'Only on `error` and `metering_failed`.',
  })
  message?: string;
}

/**
 * O gasto das chaves do owner (RN-058/060). Não traz segredo nenhum — só
 * quanto cada PROVIDER consumiu; a credencial em si nunca atravessa a
 * fronteira HTTP, nem cifrada (ADR 0050).
 */
export class CredentialSpendPorMesResponseDto {
  @ApiProperty({ example: '2026-08-01T00:00:00.000Z', format: 'date-time' })
  mes!: string;

  @ApiProperty({ example: 1_250_000 })
  costMicros!: number;

  @ApiProperty({ example: 42 })
  chamadas!: number;
}

export class CredentialSpendPorProviderResponseDto {
  @ApiProperty({ example: 'openrouter' })
  provider!: string;

  @ApiProperty({
    example: true,
    description:
      'The credential exists TODAY. `false` is historical spend from a key ' +
      'that was already removed — the consumption happened and does not ' +
      'disappear from the report because of that.',
  })
  temCredencial!: boolean;

  @ApiProperty({ example: 1_250_000 })
  costMicros!: number;

  @ApiProperty({ example: 120_000 })
  inputTokens!: number;

  @ApiProperty({ example: 35_000 })
  outputTokens!: number;

  @ApiProperty({ example: 42 })
  chamadas!: number;

  @ApiProperty({
    example: 900_000,
    description:
      'Portion spent by AGENTS — the tab RN-058 started charging to the owner.',
  })
  costMicrosAgentes!: number;

  @ApiProperty({
    example: 350_000,
    description:
      'Portion spent by PEOPLE in chat. Comes from the same key, and it is a different question.',
  })
  costMicrosPessoas!: number;

  @ApiProperty({ type: [CredentialSpendPorMesResponseDto] })
  porMes!: CredentialSpendPorMesResponseDto[];
}

export class CredentialSpendResponseDto {
  @ApiProperty({
    example: '9b1c2d3e-4f50-4a61-8b72-0c3d4e5f6a7b',
    format: 'uuid',
  })
  workspaceId!: string;

  @ApiProperty({
    example: '9b1c2d3e-4f50-4a61-8b72-0c3d4e5f6a7b',
    format: 'uuid',
    description:
      "Owner of the keys — who funds this workspace's agents (RN-058).",
  })
  ownerId!: string;

  @ApiProperty({ example: 6 })
  meses!: number;

  @ApiProperty({ example: 1_250_000 })
  totalMicros!: number;

  @ApiProperty({ type: [CredentialSpendPorProviderResponseDto] })
  porProvider!: CredentialSpendPorProviderResponseDto[];
}

/**
 * O relatório de gasto em duas audiências (FASE 22, RN-101; revisto pelo
 * ADR 0076).
 *
 * `WorkspaceSpendReportResponseDto` GANHOU a lista `porProvider` (RN-186), e
 * `MySpendResponseDto` continua sem nenhum campo de provider — a assimetria é o
 * desenho. Quebrar gasto por provider é quebrar por CREDENCIAL, e a resposta
 * de credencial é do owner (RN-060): as duas formas que a carregam,
 * `CredentialSpendResponseDto` acima e o relatório do workspace, saem de rotas
 * com `@RequireRole('owner')`. A do membro sai de uma rota `viewer`, e é por
 * isso que o eixo não entra nela.
 */
export class SpendLinhaResponseDto implements Wire<SpendLinha> {
  @ApiProperty({
    example: 'anthropic/claude-sonnet-4',
    description:
      'The grouping key: model name, provider name, project id, actor id, ' +
      'or session id, depending on which list the row appears in.',
  })
  chave!: string;

  @ApiProperty({
    example: 'Loja',
    nullable: true,
    description:
      'Readable name, when there is a table with a name (project). `null` ' +
      'when the key is already the label.',
  })
  rotulo!: string | null;

  @ApiProperty({
    example: 'agent',
    nullable: true,
    description:
      'Only the per-actor lists fill this in (`porAtor`, `porOwner`, ' +
      '`porAgente`); on the others it is `null`.',
  })
  actorKind!: string | null;

  @ApiProperty({ example: 1_250_000 })
  costMicros!: number;

  @ApiProperty({ example: 120_000 })
  inputTokens!: number;

  @ApiProperty({ example: 35_000 })
  outputTokens!: number;

  @ApiProperty({ example: 42 })
  chamadas!: number;
}
export const _chavesSpendLinha: MesmasChaves<
  SpendLinhaResponseDto,
  SpendLinha
> = true;

export class SpendPorDiaResponseDto implements Wire<SpendPorDia> {
  @ApiProperty({
    example: '2026-08-09',
    description: 'Day in UTC. The series is DENSE: a day with no spend comes as zero.',
  })
  dia!: string;

  @ApiProperty({ example: 1_250_000 })
  costMicros!: number;

  @ApiProperty({ example: 42 })
  chamadas!: number;
}
export const _chavesSpendPorDia: MesmasChaves<
  SpendPorDiaResponseDto,
  SpendPorDia
> = true;

export class WorkspaceSpendReportResponseDto implements Wire<WorkspaceSpendReport> {
  @ApiProperty({
    example: '9b1c2d3e-4f50-4a61-8b72-0c3d4e5f6a7b',
    format: 'uuid',
  })
  workspaceId!: string;

  @ApiProperty({
    example: '9b1c2d3e-4f50-4a61-8b72-0c3d4e5f6a7b',
    format: 'uuid',
    description: 'Owner of the keys that funded this spend (RN-058).',
  })
  ownerId!: string;

  @ApiProperty({ example: 30, description: 'Sliding window, in days.' })
  dias!: number;

  @ApiProperty({ example: 1_250_000 })
  totalMicros!: number;

  @ApiProperty({ example: 120_000 })
  inputTokens!: number;

  @ApiProperty({ example: 35_000 })
  outputTokens!: number;

  @ApiProperty({ example: 42 })
  chamadas!: number;

  @ApiProperty({
    type: [SpendLinhaResponseDto],
    description:
      'By MODEL. Two providers serving the same name fall into the same row ' +
      '— separating them would reintroduce the credential axis under another name.',
  })
  porModelo!: SpendLinhaResponseDto[];

  @ApiProperty({
    type: [SpendLinhaResponseDto],
    description:
      'By PROVIDER (ADR 0076, RN-186). This axis speaks of CREDENTIAL and so ' +
      "only exists here, on a route that requires `owner` (RN-060) — the " +
      "member's response does not have it, and it is not a filter that " +
      "hides it: it is the repository's type that refuses it with an actor " +
      'scope (RN-187).',
  })
  porProvider!: SpendLinhaResponseDto[];

  @ApiProperty({
    type: [SpendLinhaResponseDto],
    description: 'By PROJECT within the workspace.',
  })
  porProjeto!: SpendLinhaResponseDto[];

  @ApiProperty({
    type: [SpendLinhaResponseDto],
    description:
      'By ACTOR — agent and person in the same list, distinguished by `actorKind`.',
  })
  porAtor!: SpendLinhaResponseDto[];

  @ApiProperty({
    type: [SpendLinhaResponseDto],
    description:
      'The PERSON rows (`actor_kind = "user"`) — the block the handoff ' +
      'calls "By owner", because under RN-058 it is the owner\'s key that ' +
      'all of them spend. Who the owner is sits in `ownerId`. A partition ' +
      'of `porAtor`, with no extra query (RN-188).',
  })
  porOwner!: SpendLinhaResponseDto[];

  @ApiProperty({
    type: [SpendLinhaResponseDto],
    description:
      'The AGENT rows (`actor_kind = "agent"`). The other half of `porAtor`.',
  })
  porAgente!: SpendLinhaResponseDto[];

  @ApiProperty({ type: [SpendPorDiaResponseDto] })
  porDia!: SpendPorDiaResponseDto[];
}
export const _chavesWorkspaceSpend: MesmasChaves<
  WorkspaceSpendReportResponseDto,
  WorkspaceSpendReport
> = true;

export class MySpendResponseDto implements Wire<MySpend> {
  @ApiProperty({
    example: '9b1c2d3e-4f50-4a61-8b72-0c3d4e5f6a7b',
    format: 'uuid',
  })
  projectId!: string;

  @ApiProperty({ example: 30 })
  dias!: number;

  @ApiProperty({
    example: '9b1c2d3e-4f50-4a61-8b72-0c3d4e5f6a7b',
    format: 'uuid',
    description:
      "The report's actor — always whoever called. Another actor's row does not get in.",
  })
  actorId!: string;

  @ApiProperty({ example: 1_250_000 })
  totalMicros!: number;

  @ApiProperty({ example: 120_000 })
  inputTokens!: number;

  @ApiProperty({ example: 35_000 })
  outputTokens!: number;

  @ApiProperty({ example: 42 })
  chamadas!: number;

  @ApiProperty({ type: [SpendLinhaResponseDto] })
  porSessao!: SpendLinhaResponseDto[];

  @ApiProperty({ type: [SpendPorDiaResponseDto] })
  porDia!: SpendPorDiaResponseDto[];
}
export const _chavesMySpend: MesmasChaves<MySpendResponseDto, MySpend> = true;
