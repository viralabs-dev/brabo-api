import type { ServerResponse } from 'node:http';
import { OllamaProvider } from '../../../src/infrastructure/llm/ollama-provider';
import { runLLMProviderContract } from '../../contract/llm-provider.contract';
import {
  CATALOGO_ESPERADO,
  EMBEDDING_ESPERADO,
  FERRAMENTA_ESPERADA,
  PEDACOS_DO_TEXTO,
  STATUS_DO_CENARIO,
  USAGE_ESPERADO,
  type CenarioLLM,
} from '../../support/llm/fake-llm-server';

/** NDJSON do `/api/chat` do Ollama: uma linha JSON por evento. */
function dialetoOllama(cenario: CenarioLLM, res: ServerResponse): void {
  const status = STATUS_DO_CENARIO[cenario];
  if (status) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'falha simulada' }));
    return;
  }

  // O catálogo NÃO é ndjson nem streaming: `GET /api/tags` devolve um JSON
  // único com o array `models`, e cada linha traz `name` com a tag junto
  // (`qwen2.5-coder:7b`) — é o mesmo identificador que vai em `options.model`.
  if (cenario === 'catalogo') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        models: CATALOGO_ESPERADO.map((name) => ({
          name,
          model: name,
          modified_at: '2026-08-02T00:00:00Z',
          size: 4_683_075_271,
          digest: '0a8c266910232fd3291e71e5ba1e058cc5af9d411192cf88b6d30e92b6e73163',
          details: { format: 'gguf', family: 'qwen2', parameter_size: '7.6B' },
        })),
      }),
    );
    return;
  }

  // `POST /api/embed` também não é ndjson: um JSON único com `embeddings`
  // (plural), um vetor por entrada, mais `prompt_eval_count` — o shape
  // verificado ao vivo contra o daemon 0.32.1 (ADR 0075).
  if (cenario === 'embedding' || cenario === 'embedding_incompleto') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        model: EMBEDDING_ESPERADO.modeloRespondido,
        embeddings:
          cenario === 'embedding'
            ? EMBEDDING_ESPERADO.vetores
            : EMBEDDING_ESPERADO.vetores.slice(0, 1),
        total_duration: 446_020_157,
        load_duration: 393_094_699,
        prompt_eval_count: EMBEDDING_ESPERADO.inputTokens,
      }),
    );
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });

  if (cenario === 'tool_call') {
    res.write(
      JSON.stringify({
        message: {
          content: '',
          tool_calls: [
            {
              function: {
                name: FERRAMENTA_ESPERADA.name,
                // O Ollama devolve os argumentos JÁ desserializados — é a
                // divergência de dialeto que o contrato normaliza.
                arguments: FERRAMENTA_ESPERADA.arguments,
              },
            },
          ],
        },
      }) + '\n',
    );
    res.write(JSON.stringify({ done: true }) + '\n');
    res.end();
    return;
  }

  res.write(
    JSON.stringify({ message: { content: PEDACOS_DO_TEXTO[0] } }) + '\n',
  );

  // Linha partida entre dois writes: o buffer precisa costurar.
  const segunda =
    JSON.stringify({ message: { content: PEDACOS_DO_TEXTO[1] } }) + '\n';
  res.write(segunda.slice(0, 12));
  res.write(segunda.slice(12));

  if (cenario === 'com_usage') {
    res.write(
      JSON.stringify({
        done: true,
        prompt_eval_count: USAGE_ESPERADO.inputTokens,
        eval_count: USAGE_ESPERADO.outputTokens,
      }) + '\n',
    );
  }
  // Em `sem_usage` o stream fecha sem a linha `done` — o Ollama real só a
  // omite se o socket cair, então este cenário é a degradação teórica.

  res.end();
}

runLLMProviderContract('ollama', () => ({
  dialeto: dialetoOllama,
  criar: () => new OllamaProvider(),
  // O Ollama recebe o endereço por opção de chamada, não pelo construtor.
  chatOptions: (baseUrl) => ({ host: baseUrl }),
  usageFallback: 'nenhum',
  timeoutEnv: 'OLLAMA_REQUEST_TIMEOUT_MS',
  // `listModels` não recebe host — o daemon vem do ambiente. Ver `hostEnv`.
  hostEnv: 'OLLAMA_HOST',
  temFerramentasNoPedido: (body) => Array.isArray(body.tools),
  modelo: 'qwen2.5-coder:7b',
  // O Ollama é o único dos nove com `embeddings: true` — provado contra o
  // daemon de verdade, não contra doc (ADR 0075). `nomic-embed-text` é o
  // modelo que o `/api/tags` do daemon declara com `capabilities:
  // ["embedding"]` e 768 de dimensão.
  embedOptions: (baseUrl) => ({ host: baseUrl }),
  modeloDeEmbedding: 'nomic-embed-text',
}));
