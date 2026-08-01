import type { ServerResponse } from 'node:http';
import { OllamaProvider } from '../../../src/infrastructure/llm/ollama-provider';
import { runLLMProviderContract } from '../../contract/llm-provider.contract';
import {
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
  temFerramentasNoPedido: (body) => Array.isArray(body.tools),
  modelo: 'qwen2.5-coder:7b',
}));
