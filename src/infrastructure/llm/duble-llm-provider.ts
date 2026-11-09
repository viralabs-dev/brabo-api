import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  ChatMessage,
  ChatOptions,
  ChatStreamChunk,
  LLMProviderCapabilities,
  LLMProviderName,
  ToolCall,
} from '@brabo/shared';
import { dubleDeLlm } from '../security/ambiente';
import { LLMUpstreamError } from '../../domain/llm/llm-provider-errors';
import { LLMProvider } from '../../application/ports/llm-provider.port';

/** Nome que aparece em `token_usage.resolved_model_name`: nunca se confunde com uso real. */
export const MODELO_DUBLE = 'duble-llm';

export interface PassoDoRoteiro {
  texto?: string;
  tool_calls?: { name: string; arguments?: Record<string, unknown> }[];
  inputTokens?: number;
  outputTokens?: number;
}

/** `agentes[<agentId>]` ou `agentes["*"]`: a lista de passos do agente, um por chamada. */
export interface Roteiro {
  agentes: Record<string, PassoDoRoteiro[]>;
}

/**
 * Provider dublê do regressivo do `brabo-qa` (AT-815, RN-1065, ADR 0279). Só é
 * instanciado com `LLM_DUBLE=1` e imagem sem a marca `prd` (ver `dubleDeLlm`).
 * Ocupa o lugar do `ollama` no registry (nome do contrato compartilhado), que
 * é o provider sem credencial. O custo sai sempre 0 e o modelo resolvido sai
 * como `duble-llm`.
 *
 * shortcut: sem embed/listModels (RAG e sync de catálogo seguem sem o dublê),
 * upgrade se uma funcionalidade do regressivo precisar.
 */
export class DubleLLMProvider extends LLMProvider {
  readonly name: LLMProviderName = 'ollama';
  readonly capabilities: LLMProviderCapabilities = {
    streaming: true,
    toolCalling: true,
    listModels: false,
    embeddings: false,
    reasoningText: false,
    routingPreference: false,
    stickySession: false,
    priceCeiling: false,
    promptCaching: false,
    vision: false,
  };

  private readonly passos = new Map<string, number>();

  constructor(private readonly roteiro: Roteiro) {
    super();
  }

  static doArquivo(caminho: string): DubleLLMProvider {
    const r = JSON.parse(readFileSync(caminho, 'utf8')) as Roteiro;
    if (!r || typeof r.agentes !== 'object') {
      throw new Error(
        `roteiro do dublê inválido em ${caminho}: falta "agentes"`,
      );
    }
    return new DubleLLMProvider(r);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async *chat(
    _messages: ChatMessage[],
    options: ChatOptions,
  ): AsyncGenerator<ChatStreamChunk> {
    // sessionKey = `brabo:<sessionId>:<agentId>` (chaveDeSessao)
    const chave = options.sessionKey ?? 'sem-sessao';
    const agente = chave.split(':')[2] ?? '*';
    const lista = this.roteiro.agentes[agente] ?? this.roteiro.agentes['*'];
    if (!lista || lista.length === 0) {
      yield {
        type: 'error',
        code: new LLMUpstreamError('ollama', '').code,
        message: `dublê sem roteiro para o agente "${agente}"`,
      };
      return;
    }
    const n = this.passos.get(chave) ?? 0;
    this.passos.set(chave, n + 1);
    // Acabou o roteiro: repete o último passo.
    const passo = lista[Math.min(n, lista.length - 1)];

    if (passo.texto) yield { type: 'text_delta', text: passo.texto };
    const toolCalls: ToolCall[] = (passo.tool_calls ?? []).map((t) => ({
      id: randomUUID(),
      name: t.name,
      arguments: t.arguments ?? {},
    }));
    if (toolCalls.length > 0) yield { type: 'tool_calls', toolCalls };
    yield {
      type: 'usage',
      inputTokens: passo.inputTokens ?? 10,
      outputTokens: passo.outputTokens ?? 5,
      estimated: false,
      costMicros: 0,
      resolvedModel: MODELO_DUBLE,
    };
  }
}

/** A guarda inteira (RN-1065): o dublê ou `null`. Único ponto que decide se ele carrega. */
export function dubleSeAutorizado(
  avisar: (msg: string) => void,
  env: NodeJS.ProcessEnv = process.env,
  lerArquivo?: (caminho: string) => string,
): DubleLLMProvider | null {
  const estado = dubleDeLlm(env, lerArquivo);
  if (estado === 'bloqueado-prd') {
    avisar(
      'LLM_DUBLE=1 ignorado: imagem de produção (prd) nunca carrega o dublê',
    );
  }
  if (estado !== 'ligado') return null;
  const caminho = env.LLM_DUBLE_ROTEIRO;
  if (!caminho) throw new Error('LLM_DUBLE=1 exige LLM_DUBLE_ROTEIRO');
  avisar(`provider dublê ligado (roteiro ${caminho})`);
  return DubleLLMProvider.doArquivo(caminho);
}
