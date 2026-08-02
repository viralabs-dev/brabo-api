import { Injectable, Optional } from '@nestjs/common';
import type { LLMProviderName } from '@brabo/shared';
import { LLMCredentialConnectionTester } from '../../application/ports/llm-credential-connection-tester.port';
import { LLMCredentialConnectionTestFailedError } from '../../domain/llm/llm-credential-errors';
import { getJson, timeoutFromEnv } from './http-stream';
import { LLM_TIMEOUT_ENV } from './openai-compatible-provider';
import { OPENROUTER_BASE_URL } from './openrouter-provider';
import { NVIDIA_NIM_BASE_URL } from './nvidia-nim-provider';
import { TOGETHER_BASE_URL } from './together-provider';
import { BITDEER_BASE_URL } from './bitdeer-provider';
import { VULTR_BASE_URL } from './vultr-provider';

/**
 * Base URL default de cada provider com teste declarado — chave nova por
 * provider conforme a Fase 11b avança. `baseUrlOverrides` no construtor troca
 * qualquer uma por um servidor falso (mesmo motivo de `openrouterConfig(baseUrl)`
 * em `openrouter-provider.ts`), generalizado num mapa em vez de crescer um
 * parâmetro de construtor por provider.
 */
const BASE_URL_PADRAO: Partial<Record<LLMProviderName, string>> = {
  openrouter: OPENROUTER_BASE_URL,
  'nvidia-nim': NVIDIA_NIM_BASE_URL,
  together: TOGETHER_BASE_URL,
  bitdeer: BITDEER_BASE_URL,
  vultr: VULTR_BASE_URL,
};

/**
 * Um teste por provider, best-effort — ver o port pra por que "sem teste
 * declarado" é NO-OP, não exceção.
 *
 * OpenRouter tem um endpoint DEDICADO (`GET /key`, doc oficial) pra consultar
 * limite/saldo da própria chave. Os demais (Fase 11b) não têm um "whoami"
 * confirmado em doc pública nenhuma — `GET {baseUrl}/models` (o MESMO
 * endpoint que `listModels()` chamaria) serve de teste status-only: só o
 * código importa aqui, nunca o shape da resposta, então funciona mesmo para
 * um provider com `listModels: false`.
 */
@Injectable()
export class LLMCredentialConnectionTesterImpl
  implements LLMCredentialConnectionTester
{
  constructor(
    @Optional()
    private readonly baseUrlOverrides: Partial<Record<LLMProviderName, string>> = {},
  ) {}

  async test(provider: LLMProviderName, apiKey: string): Promise<void> {
    const baseUrl = this.baseUrlOverrides[provider] ?? BASE_URL_PADRAO[provider];
    if (!baseUrl) return; // sem teste declarado — ver o port

    try {
      const url = provider === 'openrouter' ? `${baseUrl}/key` : `${baseUrl}/models`;
      await testarComStatus(url, apiKey, provider);
    } catch (error) {
      throw new LLMCredentialConnectionTestFailedError(
        provider,
        extractMessage(error),
      );
    }
  }
}

async function testarComStatus(
  url: string,
  apiKey: string,
  provider: LLMProviderName,
): Promise<void> {
  const { status, body } = await getJson({
    url,
    headers: { Authorization: `Bearer ${apiKey}` },
    timeoutMs: timeoutFromEnv(LLM_TIMEOUT_ENV, 300_000),
    timeoutEnvName: LLM_TIMEOUT_ENV,
    provider,
  });

  if (status < 200 || status >= 300) {
    throw new Error(`${provider} respondeu ${status}: ${body.slice(0, 200)}`);
  }
}

function extractMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  return undefined;
}
