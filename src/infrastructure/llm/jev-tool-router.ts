import { Injectable } from '@nestjs/common';
import {
  ToolRouter,
  type DecidirFerramentaInput,
  type ResultadoDoRoteador,
} from '../../application/ports/tool-router.port';
import {
  ENDPOINT_DO_JEV,
  lerRespostaDoJev,
} from '../../domain/llm/tool-router';
import { timeoutFromEnv } from './http-stream';

/** Teto do Jev (AT-236 resposta 14): 0 de 328 pedidos passaram de 2 000 ms na medição. */
export const TETO_PADRAO_DO_JEV_MS = 2000;

/**
 * O adaptador do Decisions API do OpenRouter (endpoint ALPHA — pode mudar sem
 * aviso, e é por isso que toda falha vira queda nomeada, nunca exceção).
 *
 * A chave é argumento e NUNCA é logada nem devolvida. `chamar` é injetável só
 * para o teste de contrato usar uma resposta gravada, sem rede.
 */
@Injectable()
export class JevToolRouter extends ToolRouter {
  constructor(
    private readonly chamar: typeof fetch = fetch,
    private readonly timeoutMs: number = timeoutFromEnv(
      'TOOL_ROUTER_TIMEOUT_MS',
      TETO_PADRAO_DO_JEV_MS,
    ),
  ) {
    super();
  }

  async decidir(input: DecidirFerramentaInput): Promise<ResultadoDoRoteador> {
    const t0 = performance.now();
    const latencia = () => Math.round(performance.now() - t0);
    const semGasto = {
      custoUsd: null,
      tokensDeEntrada: null,
      tokensDeSaida: null,
    };
    try {
      const r = await this.chamar(ENDPOINT_DO_JEV, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input.pedido),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const texto = await r.text();
      if (!r.ok) {
        return {
          status: 'queda',
          motivo: 'erro_http',
          detalhe: `${r.status} ${texto.slice(0, 200)}`,
          latenciaMs: latencia(),
          ...semGasto,
        };
      }
      let corpo: unknown;
      try {
        corpo = JSON.parse(texto);
      } catch {
        return {
          status: 'queda',
          motivo: 'resposta_invalida',
          detalhe: texto.slice(0, 200),
          latenciaMs: latencia(),
          ...semGasto,
        };
      }
      const lida = lerRespostaDoJev(corpo, input.opcoes);
      if (lida.status !== 'ok') {
        return {
          status: 'queda',
          motivo: lida.status,
          detalhe: lida.detalhe,
          latenciaMs: latencia(),
          custoUsd: lida.custoUsd,
          tokensDeEntrada: lida.tokensDeEntrada,
          tokensDeSaida: lida.tokensDeSaida,
        };
      }
      return { status: 'decidido', resposta: lida, latenciaMs: latencia() };
    } catch (erro) {
      const nome = (erro as Error).name;
      return {
        status: 'queda',
        motivo:
          nome === 'TimeoutError' || nome === 'AbortError'
            ? 'timeout'
            : 'erro_de_rede',
        // Só o NOME do erro: a mensagem de um erro de rede pode carregar a URL.
        detalhe: nome,
        latenciaMs: latencia(),
        ...semGasto,
      };
    }
  }
}
