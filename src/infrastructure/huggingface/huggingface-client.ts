import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readBody, timeoutFromEnv } from '../llm/http-stream';
import { isOfficialPublisher } from '../../domain/llm/huggingface-official-publishers';
import {
  HuggingFaceConnectionError,
  HuggingFaceTimeoutError,
  HuggingFaceUpstreamError,
} from '../../domain/huggingface/huggingface-errors';

/**
 * Cliente fino sobre a API pública do Hugging Face Hub.
 *
 * ## Por que não importa `getJson` de `infrastructure/llm/http-stream.ts`
 *
 * Aquele módulo é declaradamente "o transporte compartilhado pelos providers
 * de LLM" — `getJson`/`postJson`/`postStream` amarram `provider` ao tipo
 * `LLMProviderName` e lançam `LLMConnectionError`/`LLMTimeoutError`
 * (`domain/llm/llm-provider-errors.ts`). O Hub não é um `LLMProvider` (não
 * conversa, não entra em `LLMProviderRegistry`), e forçar o tipo criaria um
 * `instanceof LLMProviderError` capturando uma falha que não é de LLM em
 * código de metering/roteamento que existe para outra coisa. O que É
 * reaproveitado — porque já é genérico, sem acoplamento a `LLMProviderName` —
 * é `readBody` (leitura de corpo inteiro) e `timeoutFromEnv` (mesmo teto de
 * INATIVIDADE dos outros clientes desta pasta, não de duração total). O resto
 * segue a MESMA convenção do resto do diretório: `node:https` puro, nunca
 * `fetch` (mesma razão do ADR 0020 — o timeout de headers do undici não é
 * configurável sem um `dispatcher` próprio).
 *
 * ## Sem autenticação obrigatória
 *
 * `HUGGINGFACE_API_TOKEN` é OPCIONAL — o Hub aceita busca pública sem
 * credencial. Quando presente, sobe o teto de rate limit; quando ausente, o
 * header simplesmente não é enviado (nunca um erro por falta de token).
 */
export interface HuggingFaceModel {
  /** `<publisher>/<modelo>`, ex. `meta-llama/Llama-3.1-8B-Instruct-GGUF`. */
  repoId: string;
  publisher: string;
  downloads: number;
  likes: number;
  /** `true` quando `publisher` está no allowlist curado (ADR a escrever). */
  official: boolean;
}

export interface SearchHuggingFaceModelsOptions {
  query: string;
  limit?: number;
}

// Override só para teste (servidor HTTP fake em porta efêmera, sem TLS) —
// mesmo papel de `OLLAMA_HOST` no provider do Ollama. Em produção nunca é
// definida, e o cliente fala sempre com o Hub de verdade.
const DEFAULT_HUB_BASE_URL = 'https://huggingface.co';
const TIMEOUT_ENV = 'HUGGINGFACE_REQUEST_TIMEOUT_MS';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_LIMIT = 20;

/** Uma linha de `GET /api/models`. Campos que a doc do Hub garante presentes. */
interface HubModelRow {
  id?: unknown;
  downloads?: unknown;
  likes?: unknown;
}

export async function searchHuggingFaceModels(
  options: SearchHuggingFaceModelsOptions,
): Promise<HuggingFaceModel[]> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const baseUrl = process.env.HUGGINGFACE_HUB_URL ?? DEFAULT_HUB_BASE_URL;
  const url = new URL(`${baseUrl}/api/models`);
  url.searchParams.set('search', options.query);
  url.searchParams.set('filter', 'gguf');
  url.searchParams.set('sort', 'downloads');
  url.searchParams.set('limit', String(limit));

  const token = process.env.HUGGINGFACE_API_TOKEN;
  const headers: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  const { status, body } = await getJson(url, headers);

  if (status < 200 || status >= 300) {
    throw new HuggingFaceUpstreamError(
      `Hugging Face Hub respondeu com status ${status}${resumo(body)}`,
      status,
    );
  }

  let corpo: unknown;
  try {
    corpo = JSON.parse(body);
  } catch {
    throw new HuggingFaceUpstreamError(
      'busca do Hugging Face Hub devolveu corpo que não é JSON válido',
    );
  }

  if (!Array.isArray(corpo)) {
    throw new HuggingFaceUpstreamError(
      'busca do Hugging Face Hub devolveu formato inesperado (esperava um array)',
    );
  }

  return corpo
    .filter(
      (linha): linha is HubModelRow =>
        typeof (linha as HubModelRow)?.id === 'string' &&
        (linha as HubModelRow).id !== '',
    )
    .map((linha) => {
      const repoId = linha.id as string;
      return {
        repoId,
        publisher: repoId.split('/')[0],
        downloads: numeroOu(linha.downloads, 0),
        likes: numeroOu(linha.likes, 0),
        official: isOfficialPublisher(repoId),
      };
    });
}

function numeroOu(valor: unknown, padrao: number): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : padrao;
}

const LIMITE_DO_DETALHE = 200;

function resumo(body: string | undefined): string {
  if (!body) return '';
  const limpo = body.replace(/\s+/g, ' ').trim();
  if (!limpo) return '';
  const cortado =
    limpo.length <= LIMITE_DO_DETALHE
      ? limpo
      : `${limpo.slice(0, LIMITE_DO_DETALHE)}…`;
  return `: ${cortado}`;
}

function getJson(
  url: URL,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const timeoutMs = timeoutFromEnv(TIMEOUT_ENV, DEFAULT_TIMEOUT_MS);

  return new Promise((resolve, reject) => {
    let estourouPorInatividade = false;
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;

    const req = send(
      url,
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
        new Error(`sem resposta após ${timeoutMs}ms (${TIMEOUT_ENV})`),
      );
    });

    req.on('error', (error) => {
      reject(
        estourouPorInatividade
          ? new HuggingFaceTimeoutError(
              `Hugging Face Hub sem resposta após ${timeoutMs}ms`,
              error,
            )
          : new HuggingFaceConnectionError(
              `falha ao conectar no Hugging Face Hub: ${error.message}`,
              error,
            ),
      );
    });

    req.end();
  });
}
