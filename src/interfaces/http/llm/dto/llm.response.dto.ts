import { ApiProperty } from '@nestjs/swagger';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import { BUDGET_POLICIES } from '../../../../domain/llm/budget-threshold';
import { MODEL_BINDING_SCOPES } from '../../../../domain/llm/model-binding-scope';
import type { Model } from '../../../../domain/llm/model.entity';
import type { Budget } from '../../../../domain/llm/budget.entity';
import type { ModelBinding } from '../../../../domain/llm/model-binding.entity';
import type { ResolvedBinding } from '../../../../domain/llm/binding-resolver';
import type { UserCredentialMetadata } from '../../../../domain/llm/user-credential.entity';
import type { AgentTokenUsage } from '../../../../application/ports/token-usage-repository.port';

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
    description: 'Identificador no provider.',
  })
  name!: string;

  @ApiProperty({ example: 'Claude Opus 4.8' })
  displayName!: string;

  @ApiProperty({
    example: 15000000,
    description: 'Preço por milhão de tokens de ENTRADA, em micro-USD.',
  })
  inputPricePerMillionMicros!: number;

  @ApiProperty({
    example: 75000000,
    description: 'Preço por milhão de tokens de SAÍDA, em micro-USD.',
  })
  outputPricePerMillionMicros!: number;

  @ApiProperty({
    example: 200000,
    nullable: true,
    description: 'Também é o `context_length` das capabilities do modelo.',
  })
  contextWindow!: number | null;

  @ApiProperty({
    example: true,
    description:
      'Tool calling NATIVO. Sem isto o modelo é chat-only e não pode ser ' +
      'vinculado a um agente (RN-038).',
  })
  supportsToolCalling!: boolean;

  @ApiProperty({ example: true })
  supportsStreaming!: boolean;

  @ApiProperty({ example: false })
  supportsVision!: boolean;

  @ApiProperty({
    example: true,
    description:
      'Modelo desativado some da seleção mas continua nos custos históricos.',
  })
  isActive!: boolean;

  @ApiProperty({ example: '2026-07-01T00:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-01T00:00:00.000Z', format: 'date-time' })
  updatedAt!: string;
}
export const _chavesModel: MesmasChaves<ModelResponseDto, Model> = true;

/**
 * A projeção segura de uma credencial. **Nunca** traz o segredo — nem cifrado.
 * É o único formato de credencial que atravessa a fronteira HTTP.
 */
export class UserCredentialResponseDto implements Wire<UserCredentialMetadata> {
  @ApiProperty({ example: '01JC4Z0000CREDENCIAL00000001' })
  id!: string;

  @ApiProperty({
    example: 'anthropic',
    description: 'Cobre chaves de LLM e tokens de git (`github`, `gitlab`).',
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

export class ModelBindingResponseDto implements Wire<ModelBinding> {
  @ApiProperty({ example: '01JC4Z0000BINDING00000000001' })
  id!: string;

  @ApiProperty({ enum: MODEL_BINDING_SCOPES, example: 'project' })
  scope!: Wire<ModelBinding>['scope'];

  @ApiProperty({
    example: '01JC4Z0000PROJETO0000000001',
    description:
      'Id do workspace, projeto, agente ou sessão a que o binding se prende.',
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

/** O binding já RESOLVIDO pela cascata, com a origem do valor. */
export class ResolvedBindingResponseDto implements Wire<ResolvedBinding> {
  @ApiProperty({ example: '01JC4Z0000MODELO00000000001' })
  modelId!: string;

  @ApiProperty({
    enum: MODEL_BINDING_SCOPES,
    example: 'project',
    description:
      'De qual escopo o valor veio. A cascata é sessão → agente → projeto → ' +
      'workspace, e expor a ORIGEM é o que permite a UI dizer "herdado do projeto" ' +
      'em vez de mostrar um valor sem procedência.',
  })
  origin!: Wire<ResolvedBinding>['origin'];
}
export const _chavesBindingResolvido: MesmasChaves<
  ResolvedBindingResponseDto,
  ResolvedBinding
> = true;

export class BudgetResponseDto implements Wire<Budget> {
  @ApiProperty({ example: '01JC4Z0000ORCAMENTO000000001' })
  id!: string;

  @ApiProperty({
    example: '01JC4Z0000PROJETO0000000001',
    nullable: true,
    description: 'Preenchido no orçamento de projeto; `null` no de sessão.',
  })
  projectId!: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'O oposto do acima.',
  })
  sessionId!: string | null;

  @ApiProperty({
    example: 50000000,
    description: 'Teto em micro-USD (50 USD).',
  })
  limitMicros!: number;

  @ApiProperty({
    example: 12400000,
    description: 'Gasto acumulado, em micro-USD.',
  })
  spentMicros!: number;

  @ApiProperty({
    enum: BUDGET_POLICIES,
    example: 'block',
    description:
      '`block` recusa a chamada ao estourar o teto; `allow` deixa passar e só avisa.',
  })
  policy!: Wire<Budget>['policy'];

  @ApiProperty({
    example: 70,
    description:
      'Maior limiar (70/90/100) já notificado. É ele, e não o gasto anterior, que ' +
      'serve de piso — usar o gasto faria o mesmo aviso disparar de novo a cada ' +
      'chamada depois de cruzado.',
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
    description: 'Slug do agente, ou id do usuário.',
  })
  actorId!: string;

  @ApiProperty({ example: 3400000, description: 'Custo em micro-USD.' })
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
      '`delta` traz `text` incremental; `done` fecha com a contabilidade; `error` ' +
      'aborta; `metering_failed` significa que a RESPOSTA saiu mas o custo não foi ' +
      'contabilizado — o quadro existe para essa falha não passar despercebida.',
  })
  type!: 'delta' | 'done' | 'error' | 'metering_failed';

  @ApiProperty({
    example: 'Vou abrir o épico',
    required: false,
    description: 'Só em `delta`.',
  })
  text?: string;

  @ApiProperty({ example: 1820, required: false, description: 'Só em `done`.' })
  inputTokens?: number;

  @ApiProperty({ example: 340, required: false, description: 'Só em `done`.' })
  outputTokens?: number;

  @ApiProperty({
    example: 52700,
    required: false,
    description: 'Só em `done`, micro-USD.',
  })
  costMicros?: number;

  @ApiProperty({
    example: false,
    required: false,
    description:
      'Só em `done`. `true` quando o provider não devolveu contagem e o custo foi ' +
      'ESTIMADO — o número vale menos e a UI precisa poder dizer isso.',
  })
  estimated?: boolean;

  @ApiProperty({
    example: 'orçamento da sessão esgotado',
    required: false,
    description: 'Só em `error` e `metering_failed`.',
  })
  message?: string;
}
