import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LLMProviderName } from '@brabo/shared';
import {
  LLMConnectionError,
  LLMTimeoutError,
} from '../../domain/llm/llm-provider-errors';

/**
 * Transporte de streaming compartilhado pelos providers de LLM (Fase 9a —
 * ADR 0041). Nasceu dentro do `ollama-provider.ts` no ADR 0020 e foi extraído
 * aqui quando a base OpenAI-compatível passou a precisar exatamente do mesmo
 * comportamento de socket.
 *
 * ## Por que `node:http` e não `fetch`
 *
 * O timeout de headers do undici (300s, fixo) só é configurável passando um
 * `dispatcher` próprio. Na prática o teto configurado não valia nada — o
 * `fetch` desistia antes com um opaco "fetch failed", e o agente registrava
 * "o modelo parou" para uma requisição que nunca foi respondida (ADR 0020).
 *
 * O que se ganha aqui é um teto de INATIVIDADE (não de duração total): o
 * socket é derrubado quando fica QUIETO tempo demais, valendo tanto para
 * "ainda não mandou os headers" quanto para "parou de mandar chunks no meio do
 * stream". Um turno legítimo pode demorar muito — um modelo processa milhares
 * de tokens de prompt antes do primeiro token — mas nunca fica mudo.
 */
export interface PostStreamOptions {
  url: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
  /** Aparece na mensagem de timeout para o operador saber o que ajustar. */
  timeoutEnvName: string;
  provider: LLMProviderName;
}

export function postStream(
  options: PostStreamOptions,
): Promise<IncomingMessage> {
  const { url, body, headers, timeoutMs, timeoutEnvName, provider } = options;

  return new Promise((resolve, reject) => {
    const alvo = new URL(url);
    const send = alvo.protocol === 'https:' ? httpsRequest : httpRequest;

    // `req.destroy(err)` faz o erro do timeout chegar no MESMO handler de uma
    // recusa de conexão. Sem esta marca as duas falhas seriam indistinguíveis
    // e o `code` normalizado ficaria errado justamente no caso que o ADR 0020
    // existe para diagnosticar.
    let estourouPorInatividade = false;

    const req = send(
      alvo,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...headers,
        },
        timeout: timeoutMs,
      },
      resolve,
    );

    // `timeout` só EMITE o evento; sem destruir o socket a requisição ficaria
    // pendurada para sempre mesmo depois de estourar.
    req.on('timeout', () => {
      estourouPorInatividade = true;
      req.destroy(
        new Error(`sem resposta após ${timeoutMs}ms (${timeoutEnvName})`),
      );
    });

    req.on('error', (error) => {
      reject(
        estourouPorInatividade
          ? new LLMTimeoutError(provider, error.message, error)
          : new LLMConnectionError(provider, error.message, error),
      );
    });

    req.end(body);
  });
}

export interface GetJsonOptions {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
  timeoutEnvName: string;
  provider: LLMProviderName;
}

/**
 * GET simples com corpo inteiro, para o catálogo de modelos (Fase 9c).
 *
 * Compartilha o transporte com `postStream` de propósito: a mesma marca de
 * inatividade, o mesmo par timeout/connection normalizado. Um catálogo não é
 * stream, então aqui o corpo é lido de uma vez — e o erro LANÇA, porque não há
 * turno em andamento cujo gasto precise ser preservado.
 */
export function getJson(options: GetJsonOptions): Promise<{
  status: number;
  body: string;
}> {
  const { url, headers, timeoutMs, timeoutEnvName, provider } = options;

  return new Promise((resolve, reject) => {
    const alvo = new URL(url);
    const send = alvo.protocol === 'https:' ? httpsRequest : httpRequest;
    let estourouPorInatividade = false;

    const req = send(
      alvo,
      { method: 'GET', headers, timeout: timeoutMs },
      (res) => {
        void readBody(res).then((body) =>
          resolve({ status: res.statusCode ?? 0, body }),
        );
      },
    );

    req.on('timeout', () => {
      estourouPorInatividade = true;
      req.destroy(
        new Error(`sem resposta após ${timeoutMs}ms (${timeoutEnvName})`),
      );
    });

    req.on('error', (error) => {
      reject(
        estourouPorInatividade
          ? new LLMTimeoutError(provider, error.message, error)
          : new LLMConnectionError(provider, error.message, error),
      );
    });

    req.end();
  });
}

/** Lê o corpo inteiro — só para respostas de ERRO, que são curtas. */
export async function readBody(response: IncomingMessage): Promise<string> {
  const pedacos: Buffer[] = [];
  try {
    for await (const pedaco of response) pedacos.push(pedaco as Buffer);
  } catch {
    // Corpo de erro é diagnóstico, não contrato: se o socket morrer no meio,
    // o status sozinho já classifica a falha.
  }
  return Buffer.concat(pedacos).toString('utf8');
}

/**
 * NDJSON: uma linha por evento. Costura linhas partidas entre dois chunks de
 * socket — o caso que o teste do Ollama reproduz de propósito desde a Fase 4.
 */
export async function* iterateLines(
  response: IncomingMessage,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of response) {
    buffer += decoder.decode(chunk as Buffer, { stream: true });

    let quebra: number;
    while ((quebra = buffer.indexOf('\n')) !== -1) {
      const linha = buffer.slice(0, quebra).trim();
      buffer = buffer.slice(quebra + 1);
      if (linha) yield linha;
    }
  }

  const resto = buffer.trim();
  if (resto) yield resto;
}

/**
 * SSE: frames separados por linha em branco, com o payload nas linhas `data:`.
 * Devolve só o payload — `[DONE]`, que a OpenAI e os compatíveis mandam para
 * fechar, é filtrado aqui porque não é um evento de domínio.
 *
 * Frames com múltiplas linhas `data:` são concatenados com `\n`, como manda a
 * especificação de SSE; na prática nenhum provider de chat faz isso, mas o
 * custo de acertar é uma linha.
 */
export async function* iterateSseData(
  response: IncomingMessage,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of response) {
    buffer += decoder.decode(chunk as Buffer, { stream: true });

    let quebra: number;
    while ((quebra = proximoFimDeFrame(buffer)) !== -1) {
      const frame = buffer.slice(0, quebra);
      buffer = buffer.slice(quebra).replace(/^(\r?\n){2}/, '');

      const payload = extrairData(frame);
      if (payload !== null) yield payload;
    }
  }

  const payload = extrairData(buffer);
  if (payload !== null) yield payload;
}

function proximoFimDeFrame(buffer: string): number {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

function extrairData(frame: string): string | null {
  const dados = frame
    .split(/\r?\n/)
    .filter((linha) => linha.startsWith('data:'))
    .map((linha) => linha.slice('data:'.length).trimStart());

  if (dados.length === 0) return null;

  const payload = dados.join('\n');
  return payload === '[DONE]' ? null : payload;
}

/** Teto padrão de inatividade, compartilhado por todos os providers. */
export function timeoutFromEnv(envName: string, padrao: number): number {
  const bruto = Number(process.env[envName]);
  return Number.isFinite(bruto) && bruto > 0 ? bruto : padrao;
}
