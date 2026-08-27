import { randomUUID } from 'node:crypto';
import { type IncomingMessage } from 'node:http';
import { Injectable } from '@nestjs/common';
import type {
  ChatMessage,
  ChatOptions,
  ChatStreamChunk,
  EmbeddingOptions,
  EmbeddingResult,
  LLMProviderCapabilities,
  LLMProviderName,
  ModeloDoCatalogo,
  ToolCall,
} from '@brabo/shared';
import { LLMProvider } from '../../application/ports/llm-provider.port';
import {
  LLMConnectionError,
  LLMProviderError,
  LLMUpstreamError,
  normalizeHttpStatus,
} from '../../domain/llm/llm-provider-errors';
import { extrairVetoresOllama, montarEmbedding } from './embedding-result';
import {
  getJson,
  iterateLines,
  postJson,
  postStream,
  timeoutFromEnv,
} from './http-stream';

interface OllamaToolCall {
  function?: { name?: string; arguments?: Record<string, unknown> };
}

/**
 * Uma linha do `GET /api/tags`. `capabilities` e `details.embedding_length`
 * existem desde as versões recentes do daemon (verificado na 0.32.1) e são a
 * camada de MODELO da capability de embedding (ADR 0075) — ausentes num daemon
 * antigo, e aí o campo não é declarado em vez de virar `false`.
 */
interface OllamaTagLine {
  name: string;
  capabilities?: unknown;
  details?: { embedding_length?: unknown };
}

interface OllamaChatLine {
  message?: { content?: string; tool_calls?: OllamaToolCall[] };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Uma linha do NDJSON de `POST /api/pull` (huggingface → Ollama). `status`
 * varia por fase (`pulling manifest`, `downloading <digest>`, `verifying
 * sha256 digest`, `success`) — `digest`/`total`/`completed` só acompanham as
 * linhas de download, uma por camada do modelo.
 */
export interface OllamaPullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

interface OllamaPullLine {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}

@Injectable()
export class OllamaProvider implements LLMProvider {
  readonly name: LLMProviderName = 'ollama';
  readonly capabilities: LLMProviderCapabilities = {
    streaming: true,
    toolCalling: true,
    // `GET /api/tags` verificado na doc oficial (backlog do ADR 0042
    // fechado), sem autenticação e sem paginação. O shape está em
    // `listModels` abaixo — e fica lá, não aqui: chave de objeto neste
    // literal quebra o extrator de capabilities do `docs:generate`, que casa
    // até o primeiro fecha-chave.
    listModels: true,
    // PROVADO por execução, não por doc (ADR 0075): `POST /api/embed` rodado
    // contra o daemon local (Ollama 0.32.1) com `nomic-embed-text`, 2 entradas
    // → 2 vetores de 768 e `prompt_eval_count: 10`. O `/api/tags` do mesmo
    // daemon publica `capabilities: ["embedding"]` por modelo, que é a camada
    // de MODELO da mesma decisão — ver `listModels` abaixo.
    embeddings: true,
  };

  /**
   * O catálogo local, por `GET /api/tags` (Fase 9c — o backlog do ADR 0042).
   *
   * O que a doc oficial decidiu, e que não dá para adivinhar:
   *
   * 1. **Não tem autenticação nem paginação.** É um daemon local: devolve
   *    tudo o que foi puxado para a máquina, de uma vez. O `apiKey` do
   *    contrato é ignorado aqui, e isso é a resposta certa — não um descuido.
   * 2. **`name` é o identificador com a tag** (`qwen2.5-coder:7b`), que é
   *    exatamente o que vai em `options.model`. O campo `model` irmão traz o
   *    mesmo valor; usar `name` mantém o catálogo alinhado ao que o `chat`
   *    consome.
   * 3. **Não há preço nem janela de contexto.** Modelo local não tem preço, e
   *    `details` traz família e quantização, não `num_ctx`. Ambos ficam
   *    ausentes em vez de inventados (RN-042).
   *
   * O HOST vem do ambiente, não da chamada: `listModels` recebe só `apiKey`
   * pelo contrato, enquanto `chat` aceita `options.host`. Para um daemon que é
   * um por máquina isso basta — e é o mesmo default do `chat`, então os dois
   * nunca apontam para lugares diferentes.
   */
  async listModels(_apiKey?: string): Promise<ModeloDoCatalogo[]> {
    const host = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

    const { status, body } = await getJson({
      url: `${host}/api/tags`,
      headers: {},
      timeoutMs: timeoutFromEnv(TIMEOUT_ENV, DEFAULT_REQUEST_TIMEOUT_MS),
      timeoutEnvName: TIMEOUT_ENV,
      provider: this.name,
    });

    if (status < 200 || status >= 300) {
      throw normalizeHttpStatus(this.name, status, body);
    }

    let corpo: unknown;
    try {
      corpo = JSON.parse(body);
    } catch (error) {
      throw new LLMUpstreamError(
        this.name,
        'catálogo devolvido não é JSON válido',
        error,
      );
    }

    const modelos = (corpo as { models?: unknown }).models;
    if (!Array.isArray(modelos)) {
      // LANÇA em vez de devolver `[]`: lista vazia é indistinguível de "não há
      // modelo nenhum", e o sync leria como "sumiram todos" (RN-043).
      throw new LLMUpstreamError(
        this.name,
        'catálogo sem o array `models` que a doc do /api/tags descreve',
      );
    }

    return modelos
      .filter(
        (linha): linha is OllamaTagLine =>
          typeof (linha as OllamaTagLine)?.name === 'string' &&
          (linha as OllamaTagLine).name !== '',
      )
      .map((linha) => ({
        name: linha.name,
        supportsToolCalling: this.capabilities.toolCalling,
        ...capabilityDeEmbedding(linha),
      }));
  }

  /**
   * `POST /api/embed` (ADR 0075). O que a execução contra o daemon mostrou, e
   * que a doc sozinha não resolveria:
   *
   * 1. **O shape é `{ model, embeddings: number[][], prompt_eval_count }`** —
   *    `embeddings` (plural) do endpoint novo, não o `embedding` singular do
   *    `/api/embeddings` legado. Um vetor por entrada, na ordem das entradas.
   * 2. **`prompt_eval_count` é a contagem de entrada**, e vem SEMPRE — por
   *    isso o resultado sai com `estimated: false`. Quando não vier, a
   *    montagem marca `estimated` em vez de inventar número (RN-041).
   * 3. **Modelo de chat responde `501`**, com "This server does not support
   *    embeddings" no corpo. É a camada de MODELO da capability falhando no
   *    lugar mais tarde possível — a razão de `assertCanEmbed` existir e ser
   *    chamado ANTES, por quem consome.
   *
   * O host segue a mesma regra do `chat`: opção, depois ambiente, depois o
   * default do daemon local.
   */
  async embed(
    inputs: readonly string[],
    options: EmbeddingOptions,
  ): Promise<EmbeddingResult> {
    if (inputs.length === 0) {
      throw new LLMUpstreamError(
        this.name,
        'embedding pedido sem nenhuma entrada',
      );
    }

    const host =
      options.host ?? process.env.OLLAMA_HOST ?? 'http://localhost:11434';

    const { status, body } = await postJson({
      url: `${host}/api/embed`,
      // `dimensions` não existe no Ollama: a dimensão é do modelo, e o
      // contrato manda IGNORAR em vez de falhar — o retorno diz a real.
      body: JSON.stringify({ model: options.model, input: inputs }),
      headers: {},
      timeoutMs: timeoutFromEnv(TIMEOUT_ENV, DEFAULT_REQUEST_TIMEOUT_MS),
      timeoutEnvName: TIMEOUT_ENV,
      provider: this.name,
    });

    if (status < 200 || status >= 300) {
      throw normalizeHttpStatus(this.name, status, body);
    }

    let corpo: unknown;
    try {
      corpo = JSON.parse(body);
    } catch (error) {
      throw new LLMUpstreamError(
        this.name,
        'resposta de embedding não é JSON válido',
        error,
      );
    }

    return montarEmbedding({
      provider: this.name,
      esperados: inputs.length,
      modeloPedido: options.model,
      vetores: extrairVetoresOllama(this.name, corpo),
      modeloRespondido: (corpo as { model?: unknown }).model,
      inputTokens: (corpo as { prompt_eval_count?: unknown }).prompt_eval_count,
    });
  }

  async *chat(
    messages: ChatMessage[],
    options: ChatOptions,
  ): AsyncGenerator<ChatStreamChunk> {
    const host =
      options.host ?? process.env.OLLAMA_HOST ?? 'http://localhost:11434';

    const body = JSON.stringify({
      model: options.model,
      messages,
      stream: true,
      // Ollama só aceita `tools` quando há alguma; mandar [] em modelos
      // sem suporte pode dar erro, então só inclui quando há tools.
      ...(options.tools && options.tools.length > 0
        ? { tools: toOllamaTools(options.tools) }
        : {}),
    });

    let response: IncomingMessage;
    try {
      response = await postStream({
        url: `${host}/api/chat`,
        body,
        headers: {},
        timeoutMs: timeoutFromEnv(TIMEOUT_ENV, DEFAULT_REQUEST_TIMEOUT_MS),
        timeoutEnvName: TIMEOUT_ENV,
        provider: this.name,
      });
    } catch (error) {
      // O prefixo é mantido palavra por palavra desde o ADR 0020 — é por ele
      // que se reconhece esta falha nos logs de produção e nos testes.
      yield {
        type: 'error',
        code: codigoDe(error),
        message: `Falha ao conectar no Ollama: ${(error as Error).message}`,
      };
      return;
    }

    const status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      response.destroy();
      yield {
        type: 'error',
        code: normalizeHttpStatus(this.name, status).code,
        message: `Ollama respondeu com status ${status}`,
      };
      return;
    }

    try {
      for await (const line of iterateLines(response)) {
        let parsed: OllamaChatLine;
        try {
          parsed = JSON.parse(line) as OllamaChatLine;
        } catch {
          continue; // linha corrompida/parcial — ignora, não derruba o stream
        }

        if (parsed.message?.content) {
          yield { type: 'text_delta', text: parsed.message.content };
        }
        const toolCalls = parseToolCalls(parsed.message?.tool_calls);
        if (toolCalls.length > 0) {
          yield { type: 'tool_calls', toolCalls };
        }
        if (parsed.done) {
          yield {
            type: 'usage',
            inputTokens: parsed.prompt_eval_count ?? 0,
            outputTokens: parsed.eval_count ?? 0,
            estimated: false,
          };
        }
      }
    } catch (error) {
      yield {
        type: 'error',
        code: codigoDe(error),
        message: `Stream do Ollama interrompido: ${(error as Error).message}`,
      };
    }
  }

  /**
   * `POST /api/pull` puxando um modelo do Hugging Face Hub para dentro do
   * Ollama (fluxo de Project/Workspace Settings — nunca automático: só roda
   * depois da segunda confirmação explícita do humano, ver
   * `ConfirmModelPullUseCase`).
   *
   * `model: "hf.co/<repoId>"` é a sintaxe que o Ollama documenta para puxar
   * QUALQUER repo GGUF do Hub diretamente, sem precisar de um Modelfile
   * próprio. O corpo do stream é NDJSON — mesmo padrão de `iterateLines` do
   * `chat` — mas o VOCABULÁRIO é outro: `status` textual por fase
   * (`"pulling manifest"`, `"downloading <digest>"`, `"verifying sha256
   * digest"`, `"success"`), não `message`/`tool_calls`. `onProgress` é
   * opcional porque o caminho síncrono de hoje (`ConfirmModelPullUseCase`
   * aguarda o pull inteiro antes de responder — comentário lá explica por
   * quê) não tem para quem emitir progresso incremental ainda; o parâmetro
   * já existe para quando houver.
   *
   * Lança em vez de devolver chunk de erro (mesma escolha de `embed`): não há
   * turno de chat em andamento cujo gasto precise sobreviver a esta chamada.
   */
  async pullModel(
    repoId: string,
    onProgress?: (evento: OllamaPullProgress) => void,
  ): Promise<void> {
    const host = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
    const body = JSON.stringify({ model: `hf.co/${repoId}`, stream: true });

    let response: IncomingMessage;
    try {
      response = await postStream({
        url: `${host}/api/pull`,
        body,
        headers: {},
        timeoutMs: timeoutFromEnv(TIMEOUT_ENV, DEFAULT_REQUEST_TIMEOUT_MS),
        timeoutEnvName: TIMEOUT_ENV,
        provider: this.name,
      });
    } catch (error) {
      throw error instanceof LLMProviderError
        ? error
        : new LLMConnectionError(
            this.name,
            `falha ao conectar no Ollama para o pull: ${(error as Error).message}`,
            error,
          );
    }

    const status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      response.destroy();
      throw normalizeHttpStatus(this.name, status);
    }

    let ultimoStatus: string | undefined;
    for await (const line of iterateLines(response)) {
      let parsed: OllamaPullLine;
      try {
        parsed = JSON.parse(line) as OllamaPullLine;
      } catch {
        continue; // linha corrompida/parcial — ignora, não derruba o pull
      }

      // O Ollama pode reportar falha (repo/tag inexistente, manifest
      // inválido) DENTRO do stream 200, não só por status HTTP — mesmo
      // formato de erro do `/api/chat`, que `chat()` acima também trata como
      // linha de dados em vez de rejeição de socket.
      if (parsed.error) {
        throw new LLMUpstreamError(
          this.name,
          `pull de "${repoId}" falhou: ${parsed.error}`,
        );
      }

      if (parsed.status) {
        ultimoStatus = parsed.status;
        onProgress?.({
          status: parsed.status,
          digest: parsed.digest,
          total: parsed.total,
          completed: parsed.completed,
        });
      }
    }

    if (ultimoStatus !== 'success') {
      throw new LLMUpstreamError(
        this.name,
        `pull de "${repoId}" terminou sem confirmação de sucesso (último status: ${ultimoStatus ?? 'nenhum'})`,
      );
    }
  }
}

// Teto de INATIVIDADE do socket (não de duração total) — ver a explicação
// completa em http-stream.ts. O Ollama tem env própria porque um modelo local
// tem outra ordem de grandeza de latência até o primeiro token.
const TIMEOUT_ENV = 'OLLAMA_REQUEST_TIMEOUT_MS';
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

function codigoDe(error: unknown) {
  return error instanceof LLMProviderError
    ? error.code
    : new LLMUpstreamError('ollama', String(error)).code;
}

/**
 * A camada de MODELO da capability de embedding, lida do catálogo (ADR 0075).
 *
 * O Ollama é o único dos nove que publica isso por modelo: `capabilities`
 * traz `"embedding"` para `nomic-embed-text` e `["completion","tools"]` para
 * `llama3.2`. Daemon sem o campo devolve objeto VAZIO — ausência é "não
 * disse", e deduzir do nome do modelo seria palpite vestido de dado.
 */
function capabilityDeEmbedding(linha: OllamaTagLine): {
  supportsEmbeddings?: boolean;
  embeddingDimensions?: number;
} {
  if (!Array.isArray(linha.capabilities)) return {};

  const ehEmbedding = linha.capabilities.includes('embedding');
  const dimensao = linha.details?.embedding_length;

  return {
    supportsEmbeddings: ehEmbedding,
    // A dimensão só acompanha quem é de embedding: todo modelo de chat também
    // tem `embedding_length` (é o tamanho do vetor INTERNO dele), e copiá-lo
    // faria um modelo de chat parecer indexável.
    ...(ehEmbedding && typeof dimensao === 'number' && dimensao > 0
      ? { embeddingDimensions: dimensao }
      : {}),
  };
}

function toOllamaTools(tools: NonNullable<ChatOptions['tools']>) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function parseToolCalls(raw: OllamaToolCall[] | undefined): ToolCall[] {
  if (!raw) return [];
  return raw
    .filter((tc) => tc.function?.name)
    .map((tc) => ({
      id: randomUUID(),
      name: tc.function!.name!,
      arguments: tc.function!.arguments ?? {},
    }));
}
