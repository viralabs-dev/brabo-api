import { timeoutFromEnv } from './http-stream';

/**
 * A configuração do Laya (AT-626). Lida a cada uso para o teste poder mudar.
 * Os padrões são os do levantamento de 31/10/2026; a lane GPU (R354-L1) ainda
 * mede VRAM do ensemble e limiar finais, e o ajuste é só trocar a variável.
 */
export function configDoLaya() {
  const url = process.env.TOOL_ROUTER_URL?.trim().replace(/\/+$/, '');
  return {
    url: url ? url : null,
    apiKey: process.env.TOOL_ROUTER_API_KEY?.trim() || null,
    /** Abaixo disto o Laya "não sabe": catálogo inteiro (regra p3 + limiar). */
    limiar: timeoutFromEnv('TOOL_ROUTER_LAYA_LIMIAR', 0.72),
    /** Régua do dono (31/10): p95 da sonda de boot <= 500 ms. */
    p95MaxMs: timeoutFromEnv('TOOL_ROUTER_LAYA_P95_MAX_MS', 500),
    /** VRAM livre mínima; 2 GiB é o da decisão de 31/10 (o do ensemble vem da AT-630). */
    vramMinMiB: timeoutFromEnv('TOOL_ROUTER_LAYA_VRAM_MIN_MIB', 2048),
    timeoutMs: timeoutFromEnv('TOOL_ROUTER_LAYA_TIMEOUT_MS', 2000),
    modelo: process.env.TOOL_ROUTER_LAYA_MODELO?.trim() || 'multilingual',
    maxLen: timeoutFromEnv('TOOL_ROUTER_LAYA_MAX_LEN', 2048),
  };
}
