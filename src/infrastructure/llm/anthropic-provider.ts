import { precoDoFabricante } from '../../domain/llm/precos-do-fabricante';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { textoDoConteudo } from '../../domain/llm/anexos-no-turno';
import Anthropic from '@anthropic-ai/sdk';
import type {
  ChatMessage,
  ChatOptions,
  ChatStreamChunk,
  LLMProviderCapabilities,
  LLMProviderName,
  ModeloDoCatalogo,
  ThinkingBlock,
  ToolCall,
  ToolDef,
} from '@brabo/shared';
import { LLMProvider } from '../../application/ports/llm-provider.port';
import {
  LLMConnectionError,
  LLMTimeoutError,
  normalizeHttpStatus,
} from '../../domain/llm/llm-provider-errors';
import { withIdleTimeout } from './idle-timeout';
import { LLM_TIMEOUT_ENV, toErrorChunk } from './openai-compatible-provider';
import { timeoutFromEnv } from './http-stream';

const DEFAULT_MAX_TOKENS = 4096;
/** A folga do raciocínio no `max_tokens` quando o modelo não declara orçamento (RN-741). */
const FOLGA_DE_RACIOCINIO_PADRAO = 4096;
const DEFAULT_TIMEOUT_MS = 300_000;

/** Token de DI para os overrides que só a suite de contrato usa. */
export const ANTHROPIC_OPTIONS = 'ANTHROPIC_OPTIONS';

export interface AnthropicOptions {
  /** Aponta o SDK para outro host (servidor falso da suite de contrato). */
  baseURL?: string;
  /**
   * O SDK repete 429 e 5xx sozinho. No teste de rate limit isso transformaria
   * uma asserção de um segundo em vários — e escondia qual resposta foi
   * classificada.
   */
  maxRetries?: number;
}

/**
 * O Anthropic NÃO fala o dialeto `/chat/completions`, então continua no SDK
 * oficial em vez de derivar da base compatível (Fase 9a — ADR 0041). O que
 * mudou aqui foi o alinhamento ao contrato: tool calling nativo, erros
 * normalizados por status e teto de inatividade via `withIdleTimeout`.
 */
@Injectable()
export class AnthropicProvider implements LLMProvider {
  readonly name: LLMProviderName = 'anthropic';
  readonly capabilities: LLMProviderCapabilities = {
    streaming: true,
    toolCalling: true,
    // `GET /v1/models` verificado na doc oficial (backlog do ADR 0042
    // fechado), paginado por cursor. O shape está em `listModels` abaixo —
    // e fica lá, não aqui: chave de objeto neste literal quebra o extrator
    // de capabilities do `docs:generate`, que casa até o primeiro fecha-chave.
    listModels: true,
    // A Anthropic não tem endpoint de embedding próprio — a doc dela manda
    // usar um terceiro (Voyage AI), que é OUTRO provider, com outra chave e
    // outro dialeto. Aqui `false` não é falta de prova: é ausência da
    // operação, e por isso este é o único dos nove que não vira `true` nem
    // com credencial na mão (ADR 0075).
    embeddings: false,
    // PROVADO em 2026-11-03 (AT-676, RN-993): `anthropic-provider.raciocinio.smoke.spec.ts`
    // com claude-haiku-5-5 e claude-sonnet-5-5. Na Anthropic o texto é o RESUMO do raciocínio.
    reasoningText: true,
    // Não é hub: não há upstreams entre os quais escolher (ADR 0166).
    routingPreference: false,
    stickySession: false,
    priceCeiling: false,
    // RN-1008 (AT-744): `cache_control` no prefixo do `system` e na última `user`.
    promptCaching: true,
    vision: false,
  };
  // AT-739: Haiku 5.5 desliga, Sonnet 5.5 pensa só entre ferramentas, Opus 5.5
  // REDUZ (`effort: low`) — ver `raciocinioDesligado`. RN-916.
  readonly aceitaRaciocinioDesligado = true;

  constructor(
    @Optional()
    @Inject(ANTHROPIC_OPTIONS)
    private readonly options?: AnthropicOptions,
  ) {}

  /**
   * O catálogo remoto, por `GET /v1/models` (Fase 9c — o backlog do ADR 0042).
   *
   * Três coisas que a doc oficial decidiu, e que não dá para adivinhar:
   *
   * 1. **É paginado por cursor**, não por offset: `has_more` + `last_id` como
   *    `after_id` da próxima página, com `limit` de 1 a 1000. O
   *    `client.models.list` do SDK já expõe iteração automática, e é ela que
   *    usamos — reimplementar o laço de cursor à mão seria repetir código que
   *    o SDK mantém.
   * 2. **`max_input_tokens` é a janela de contexto**, e é o único campo que o
   *    catálogo do Brabo consegue aproveitar além do id e do nome legível.
   * 3. **Preço NÃO vem** nesta resposta. O preço sai de `precoDoFabricante`
   *    (tabela única da RN-965, ADR 0251, RN-997); modelo FORA da tabela entra sem
   *    preço em vez de com preço inventado (RN-042 — o custo gravado tem que
   *    ser reproduzível). O raciocínio vem de `capabilities.thinking` do SDK.
   *
   * Erro LANÇA, como o contrato exige: lista vazia seria lida pelo sync como
   * "sumiram todos" e indisponibilizaria o catálogo inteiro (RN-043).
   */
  async listModels(apiKey?: string): Promise<ModeloDoCatalogo[]> {
    const client = new Anthropic({
      apiKey,
      ...(this.options?.baseURL ? { baseURL: this.options.baseURL } : {}),
      ...(this.options?.maxRetries !== undefined
        ? { maxRetries: this.options.maxRetries }
        : {}),
    });

    try {
      const modelos: ModeloDoCatalogo[] = [];

      // `limit: 1000` é o teto documentado. Com a auto-paginação do SDK, o
      // limite alto só reduz o número de idas à rede — não muda o resultado.
      for await (const modelo of client.models.list({ limit: 1000 })) {
        modelos.push({
          name: modelo.id,
          displayName: modelo.display_name,
          // `max_input_tokens` pode vir 0 quando o provider não o declara
          // para aquele modelo; 0 não é janela, é ausência.
          ...(typeof modelo.max_input_tokens === 'number' &&
          modelo.max_input_tokens > 0
            ? { contextLength: modelo.max_input_tokens }
            : {}),
          // Todo modelo servido pela Messages API aceita `tools`.
          supportsToolCalling: true,
          // shortcut: `capabilities` vem nulo em modelo antigo; aí vale a família
          // (todo Claude 4+ raciocina), rever quando o SDK sempre preencher.
          supportsReasoning:
            modelo.capabilities?.thinking?.supported ??
            !/^claude-3/.test(modelo.id),
          ...precoDeLista(modelo.id),
        });
      }

      return modelos;
    } catch (error) {
      // O MESMO `normalize` do `chat`, e não um tratamento paralelo: é ele que
      // mapeia timeout, falha de conexão e status HTTP para os erros
      // normalizados por `code` (ADR 0041). Aqui o resultado é LANÇADO em vez
      // de virar chunk — não há turno em andamento para preservar.
      throw this.normalize(error);
    }
  }

  async *chat(
    messages: ChatMessage[],
    options: ChatOptions,
  ): AsyncGenerator<ChatStreamChunk> {
    const client = new Anthropic({
      apiKey: options.apiKey,
      ...(this.options?.baseURL ? { baseURL: this.options.baseURL } : {}),
      ...(this.options?.maxRetries !== undefined
        ? { maxRetries: this.options.maxRetries }
        : {}),
    });

    const { system, conversation } = comCaudaDeSistema(
      blocosDeSistema(messages),
      marcarCacheDaConversa(
        toConversation(messages.filter((message) => message.role !== 'system')),
      ),
      caudaDeSistema(messages),
    );

    const tetoDeInatividade = timeoutFromEnv(
      LLM_TIMEOUT_ENV,
      DEFAULT_TIMEOUT_MS,
    );

    try {
      // AT-676/AT-739: o corpo de raciocínio sai de `corpoDeRaciocinio`, por
      // geração e, com o raciocínio desligado, por modelo.
      const stream = client.messages.stream({
        model: options.model,
        ...corpoDeRaciocinio(options),
        ...(system ? { system } : {}),
        messages: conversation,
        ...(options.tools && options.tools.length > 0
          ? { tools: options.tools.map(toAnthropicTool) }
          : {}),
      });

      const eventos = withIdleTimeout(
        stream,
        tetoDeInatividade,
        () =>
          new LLMTimeoutError(
            this.name,
            `sem resposta após ${tetoDeInatividade}ms (${LLM_TIMEOUT_ENV})`,
          ),
      );

      // O SDK 0.113 não copia `output_tokens_details` do `message_delta` para a
      // mensagem final; o último `message_delta` é a fonte (RN-666).
      let detalhesDaSaida: unknown;
      for await (const event of eventos) {
        if (event.type === 'message_delta')
          detalhesDaSaida =
            event.usage.output_tokens_details ?? detalhesDaSaida;
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield { type: 'text_delta', text: event.delta.text };
        }
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'thinking_delta' &&
          event.delta.thinking
        ) {
          yield { type: 'reasoning', text: event.delta.thinking };
        }
      }

      // Os blocos `tool_use` vêm fatiados em `input_json_delta`; o SDK já
      // remonta e desserializa o `input`, então lê-los da mensagem final custa
      // menos e erra menos que reimplementar a costura aqui. Como no Ollama,
      // o consumidor recebe as chamadas de uma vez só, não incrementalmente.
      const finalMessage = await stream.finalMessage();

      const toolCalls = toToolCalls(finalMessage.content);
      // Os blocos de pensamento voltam INTACTOS no mesmo chunk das chamadas:
      // a API exige reenviá-los no turno `assistant` com `tool_use`.
      const thinkingBlocks = toThinkingBlocks(finalMessage.content);
      if (toolCalls.length > 0)
        yield {
          type: 'tool_calls',
          toolCalls,
          ...(thinkingBlocks.length > 0 ? { thinkingBlocks } : {}),
        };
      // `stop_reason: "max_tokens"` (RN-737): o teto de saída cortou a resposta.
      if (finalMessage.stop_reason === 'max_tokens')
        yield { type: 'truncated' };

      yield {
        type: 'usage',
        ...usageDeEntrada(finalMessage.usage, options.model),
        outputTokens: finalMessage.usage.output_tokens,
        estimated: false,
        ...tokensDeRaciocinio(
          detalhesDaSaida ?? finalMessage.usage.output_tokens_details,
        ),
      };
    } catch (error) {
      yield toErrorChunk(this.normalize(error), this.name);
    }
  }

  private normalize(error: unknown): unknown {
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      return new LLMTimeoutError(this.name, error.message, error);
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return new LLMConnectionError(this.name, error.message, error);
    }
    if (
      error instanceof Anthropic.APIError &&
      typeof error.status === 'number'
    ) {
      return normalizeHttpStatus(
        this.name,
        error.status,
        typeof error.message === 'string' ? error.message : undefined,
      );
    }
    return error;
  }
}

// --- Mapeamento ---

type Ponto = { cache_control?: { type: 'ephemeral' } };

type BlocoDeConteudo =
  | ({ type: 'text'; text: string } & Ponto)
  | ({
      type: 'image';
      source: { type: 'base64'; media_type: 'image/png'; data: string };
    } & Ponto)
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | ThinkingBlock
  | ({ type: 'tool_result'; tool_use_id: string; content: string } & Ponto);

interface TurnoAnthropic {
  role: 'user' | 'assistant';
  content: string | BlocoDeConteudo[];
}

/**
 * O Anthropic não tem papel `tool`: o resultado de uma ferramenta é um bloco
 * `tool_result` dentro de um turno de USER, e resultados de chamadas paralelas
 * precisam vir no MESMO turno. Por isso mensagens `tool` consecutivas são
 * agrupadas — antes disto elas eram achatadas em texto de `user`, o que fazia
 * o modelo perder o vínculo com a chamada que as originou.
 */
function toConversation(messages: ChatMessage[]): TurnoAnthropic[] {
  const turnos: TurnoAnthropic[] = [];

  for (const message of messages) {
    if (message.role === 'tool') {
      const bloco: BlocoDeConteudo = {
        type: 'tool_result',
        tool_use_id: message.toolCallId ?? '',
        content: textoDoConteudo(message.content),
      };

      const ultimo = turnos.at(-1);
      if (ultimo && ultimo.role === 'user' && Array.isArray(ultimo.content)) {
        ultimo.content.push(bloco);
      } else {
        turnos.push({ role: 'user', content: [bloco] });
      }
      continue;
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      // Pensamento ANTES de texto e `tool_use` (ordem exigida pela API).
      const blocos: BlocoDeConteudo[] = [...(message.thinkingBlocks ?? [])];
      if (message.content.length > 0) {
        blocos.push({ type: 'text', text: textoDoConteudo(message.content) });
      }
      for (const chamada of message.toolCalls) {
        blocos.push({
          type: 'tool_use',
          id: chamada.id,
          name: chamada.name,
          input: chamada.arguments,
        });
      }
      turnos.push({ role: 'assistant', content: blocos });
      continue;
    }

    turnos.push({
      role: message.role as 'user' | 'assistant',
      content:
        typeof message.content === 'string'
          ? message.content
          : message.content.map((p) =>
              p.type === 'text'
                ? p
                : {
                    type: 'image' as const,
                    source: {
                      type: 'base64' as const,
                      media_type: p.mime as 'image/png',
                      data: p.base64,
                    },
                  },
            ),
    });
  }

  return turnos;
}

const EFEMERO = { type: 'ephemeral' } as const;

/** Mensagens `system` antes da primeira não-system (o prefixo estável) e depois dela (a cauda). */
function particaoDeSistema(messages: ChatMessage[]): [string, string] {
  const sistema = messages.filter((m) => m.role === 'system');
  const fim = messages.findIndex((m) => m.role !== 'system');
  const nPrefixo = fim === -1 ? sistema.length : fim;
  const junta = (ms: ChatMessage[]) =>
    ms.map((m) => textoDoConteudo(m.content)).join('\n\n');
  return [junta(sistema.slice(0, nPrefixo)), junta(sistema.slice(nPrefixo))];
}

/**
 * `system` do topo = só o PREFIXO (as `system` antes da primeira não-system),
 * com o ponto de cache (RN-1008). A cauda NÃO sobe para cá (RN-1015): ver
 * `caudaDeSistema` e `comCaudaDeSistema`.
 */
export function blocosDeSistema(
  messages: ChatMessage[],
): Anthropic.TextBlockParam[] | undefined {
  const [prefixo] = particaoDeSistema(messages);
  return prefixo
    ? [{ type: 'text', text: prefixo, cache_control: EFEMERO }]
    : undefined;
}

/** Texto das `system` tardias (RN-622/878: a orientação efêmera do fim da lista); vazio se não há. */
export function caudaDeSistema(messages: ChatMessage[]): string {
  return particaoDeSistema(messages)[1];
}

/**
 * RN-1015: a cauda vira o ÚLTIMO bloco de texto do último turno `user`, DEPOIS
 * do ponto de cache da conversa (o cache da RN-1008 não muda), para o modelo a
 * ler junto do contexto recente. Se a conversa não termina em `user`, a cauda
 * fica como 2º bloco do `system`, sem ponto.
 */
export function comCaudaDeSistema(
  system: Anthropic.TextBlockParam[] | undefined,
  conversa: TurnoAnthropic[],
  cauda: string,
): {
  system: Anthropic.TextBlockParam[] | undefined;
  conversation: TurnoAnthropic[];
} {
  if (!cauda) return { system, conversation: conversa };
  const bloco = { type: 'text', text: cauda } as const;
  const ultimo = conversa.at(-1);
  if (ultimo?.role !== 'user') {
    return { system: [...(system ?? []), bloco], conversation: conversa };
  }
  const conteudo: BlocoDeConteudo[] =
    typeof ultimo.content === 'string'
      ? ultimo.content
        ? [{ type: 'text', text: ultimo.content }]
        : []
      : [...ultimo.content];
  return {
    system,
    conversation: [
      ...conversa.slice(0, -1),
      { ...ultimo, content: [...conteudo, bloco] },
    ],
  };
}

/** Um ponto no último bloco do turno `i`; texto vazio e `tool_use`/raciocínio não levam ponto. */
function marcarTurno(turnos: TurnoAnthropic[], i: number): TurnoAnthropic[] {
  const { content } = turnos[i];
  const blocos: BlocoDeConteudo[] =
    typeof content === 'string'
      ? content
        ? [{ type: 'text', text: content }]
        : []
      : [...content];
  const ultimo = blocos.at(-1);
  if (!ultimo || ultimo.type === 'tool_use' || ultimo.type === 'thinking') {
    return turnos;
  }
  if (ultimo.type === 'redacted_thinking') return turnos;
  blocos[blocos.length - 1] = { ...ultimo, cache_control: EFEMERO };
  return turnos.map((t, j) => (j === i ? { ...t, content: blocos } : t));
}

/**
 * Pontos de cache da conversa (RN-1008, RN-1014): o último bloco da última E da
 * penúltima `user` (resultado de ferramenta também é `user`). Com o do `system`
 * são 3 dos 4 pontos permitidos. O da penúltima é onde a chamada anterior
 * gravou, e não depende da janela de ~20 blocos da Anthropic.
 */
export function marcarCacheDaConversa(
  turnos: TurnoAnthropic[],
): TurnoAnthropic[] {
  const users = turnos.flatMap((t, i) => (t.role === 'user' ? [i] : []));
  return users.slice(-2).reduce(marcarTurno, turnos);
}

/**
 * Entrada do `usage` (RN-1008): o `input_tokens` da Anthropic é só o NÃO
 * cacheado, então a entrada é a soma das três parcelas, e `cachedInputTokens`
 * é a leitura. Com cache em jogo, o custo vem das 4 parcelas × a tabela do
 * fabricante (ADR 0188); sem cache o caminho do catálogo dá o mesmo número.
 * Modelo fora da tabela não emite custo (RN-042).
 */
export function usageDeEntrada(
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  },
  modelo: string,
): { inputTokens: number; cachedInputTokens?: number; costMicros?: number } {
  const leitura = usage.cache_read_input_tokens;
  const escrita = usage.cache_creation_input_tokens;
  const inputTokens = usage.input_tokens + (leitura ?? 0) + (escrita ?? 0);
  const saida: {
    inputTokens: number;
    cachedInputTokens?: number;
    costMicros?: number;
  } = { inputTokens };
  if (typeof leitura === 'number') saida.cachedInputTokens = leitura;
  const preco =
    precoDoFabricante(modelo) ??
    precoDoFabricante(modelo.replace(/-\d{8}$/, ''));
  if (preco && ((leitura ?? 0) > 0 || (escrita ?? 0) > 0)) {
    // Opus 5.5 lê a 0,05x ($0,20 de $4); os demais a 0,1x. Escrita 5 min = 1,25x.
    // shortcut: Haiku 5.5 acima de 100k de prompt tem outra tabela; ignorado, rever se a medição divergir.
    const leitura05 = /^claude-opus-5[-.]5/.test(modelo) ? 0.05 : 0.1;
    const entrada =
      usage.input_tokens + (leitura ?? 0) * leitura05 + (escrita ?? 0) * 1.25;
    saida.costMicros = Math.round(
      (entrada * preco.entradaMicros +
        usage.output_tokens * preco.saidaMicros) /
        1_000_000,
    );
  }
  return saida;
}

function toAnthropicTool(tool: ToolDef) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as { type: 'object' },
  };
}

function toToolCalls(content: { type: string }[]): ToolCall[] {
  return content
    .filter(
      (
        bloco,
      ): bloco is {
        type: 'tool_use';
        id: string;
        name: string;
        input: unknown;
      } => bloco.type === 'tool_use',
    )
    .map((bloco) => ({
      id: bloco.id,
      name: bloco.name,
      arguments:
        typeof bloco.input === 'object' && bloco.input !== null
          ? (bloco.input as Record<string, unknown>)
          : {},
    }));
}

function toThinkingBlocks(content: { type: string }[]): ThinkingBlock[] {
  return content.filter(
    (bloco): bloco is ThinkingBlock =>
      bloco.type === 'thinking' || bloco.type === 'redacted_thinking',
  );
}

/** Preço da tabela única do fabricante (RN-965); casa o id com e sem sufixo de data. */
function precoDeLista(id: string): {
  inputPricePerMillionMicros?: number;
  outputPricePerMillionMicros?: number;
} {
  const p =
    precoDoFabricante(id) ?? precoDoFabricante(id.replace(/-\d{8}$/, ''));
  return p
    ? {
        inputPricePerMillionMicros: p.entradaMicros,
        outputPricePerMillionMicros: p.saidaMicros,
      }
    : {};
}

/** Modelos antigos (3.x e 4.0..4.5, com ou sem data) seguem em `enabled` + budget; o resto, adaptive. */
export function pensamentoAdaptativo(modelo: string): boolean {
  return !/^claude-3|^claude-[a-z]+-4(-[0-5])?(-\d{8})?$/.test(modelo);
}

/**
 * O que o corpo da Messages API leva de raciocínio (AT-676, AT-739).
 *
 * - Sem `reasoning`: nada, `max_tokens` puro.
 * - Modelo antigo ligado: `enabled` + `budget_tokens` (>= 1024), somado ao teto.
 * - Modelo adaptativo ligado: `adaptive` + `display: summarized` (o padrão
 *   omitted devolve texto vazio), sem `budget_tokens`; o `max_tokens` ganha a
 *   folga da RN-741, porque no adaptativo o teto é TOTAL (raciocínio + texto).
 * - Desligado (`reasoningOff`, RN-783): `raciocinioDesligado` por modelo.
 */
export function corpoDeRaciocinio(options: ChatOptions): {
  max_tokens: number;
  thinking?: Anthropic.ThinkingConfigParam;
  output_config?: Anthropic.OutputConfig;
} {
  const teto = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const folga = options.reasoningBudget ?? FOLGA_DE_RACIOCINIO_PADRAO;
  if (!options.reasoning) return { max_tokens: teto };
  const adaptativo = pensamentoAdaptativo(options.model);
  // Modelo antigo sem `thinking` não pensa: omitir já é desligar.
  if (options.reasoningOff && !adaptativo) return { max_tokens: teto };
  if (options.reasoningOff) {
    const { pensaAinda, ...corpo } = raciocinioDesligado(options.model);
    return { max_tokens: teto + (pensaAinda ? folga : 0), ...corpo };
  }
  if (!adaptativo) {
    const orcamento = Math.max(1024, options.reasoningBudget ?? 2048);
    return {
      max_tokens: teto + orcamento,
      thinking: { type: 'enabled', budget_tokens: orcamento },
    };
  }
  return {
    max_tokens: teto + folga,
    thinking: { type: 'adaptive', display: 'summarized' },
  };
}

/**
 * Como DESLIGAR o raciocínio num modelo adaptativo, por modelo (AT-739,
 * decisão do dono de 05/11, provado no smoke). `thinking: disabled` é 400 no
 * Sonnet 5.5 e no Opus 5.5, mas NÃO no Haiku 5.5. Omitir o `thinking` nos 5.5
 * é o adaptativo no esforço padrão — não desliga nada.
 *
 * - Haiku 5.5: `disabled` — desligado de verdade.
 * - Sonnet 5.5: `between_tools` — pensa só entre chamadas de ferramenta.
 * - Opus 5.5 e Sonnet 5 (AT-920, forma sem smoke): `effort: low` — REDUZIDO, não desligado.
 * - Desconhecido: nada (o padrão do modelo), com a folga — reduzir exige prova.
 *
 * `pensaAinda` diz se o modelo ainda pode pensar, e decide a folga.
 */
export function raciocinioDesligado(modelo: string): {
  thinking?: Anthropic.ThinkingConfigParam;
  output_config?: Anthropic.OutputConfig;
  pensaAinda: boolean;
} {
  if (/^claude-haiku-5-5/.test(modelo))
    return { thinking: { type: 'disabled' }, pensaAinda: false };
  if (/^claude-sonnet-5-5/.test(modelo))
    // O SDK 0.113 ainda não tipa `between_tools`.
    return {
      thinking: {
        type: 'between_tools',
      } as unknown as Anthropic.ThinkingConfigParam,
      pensaAinda: true,
    };
  if (/^claude-(opus-5-5|sonnet-5(?!-5))/.test(modelo))
    return { output_config: { effort: 'low' }, pensaAinda: true };
  return { pensaAinda: true };
}

/** `thinking_tokens` só quando é inteiro >= 0; senão omitido, e a coluna fica NULL (RN-666). */
function tokensDeRaciocinio(detalhes: unknown): { reasoningTokens?: number } {
  const n = (detalhes as { thinking_tokens?: unknown } | null | undefined)
    ?.thinking_tokens;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0
    ? { reasoningTokens: n }
    : {};
}
