import { Injectable } from '@nestjs/common';
import {
  ToolRouterLocal,
  type DecidirFerramentaInput,
  type ResultadoDoRoteador,
} from '../../application/ports/tool-router.port';
import {
  MODELO_DO_LAYA,
  RESPONDER_SEM_FERRAMENTA,
  lerRespostaDoJev,
} from '../../domain/llm/tool-router';
import { configDoLaya } from './laya-config';

/**
 * O adaptador do Laya, o serviço local da 6ª imagem (AT-626, ADR 0290). Mesmo
 * formato do Decisions API, UMA chamada que já devolve a média do ensemble.
 * Diferenças para o Jev: sem a opção reservada no pedido (o Laya nunca a viu no
 * treino), sem chave (a `TOOL_ROUTER_API_KEY` é opcional), sem gasto, e a regra
 * p3 + limiar: confiança abaixo do limiar vira `responder_sem_ferramenta`, que
 * deixa o catálogo inteiro. Nunca lança: toda falha é queda nomeada.
 */
@Injectable()
export class LayaToolRouter extends ToolRouterLocal {
  constructor(private readonly chamar: typeof fetch = fetch) {
    super();
  }

  async decidir(input: DecidirFerramentaInput): Promise<ResultadoDoRoteador> {
    const cfg = configDoLaya();
    const t0 = performance.now();
    const base = () => ({
      latenciaMs: Math.round(performance.now() - t0),
      modelo: MODELO_DO_LAYA,
    });
    const semGasto = {
      custoUsd: null,
      tokensDeEntrada: null,
      tokensDeSaida: null,
    };
    if (!cfg.url) {
      return {
        status: 'queda',
        motivo: 'erro_de_rede',
        detalhe: 'nao_configurado',
        ...base(),
        ...semGasto,
      };
    }
    try {
      const questions = Object.fromEntries(
        Object.entries(input.pedido.questions).map(([id, q]) => {
          const { [RESPONDER_SEM_FERRAMENTA]: _reservada, ...criteria } =
            q.criteria;
          return [id, { ...q, criteria }];
        }),
      );
      const r = await this.chamar(`${cfg.url}/v1/systemone`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: cfg.modelo,
          state: input.pedido.state,
          questions,
          max_len: cfg.maxLen,
        }),
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
      const texto = await r.text();
      if (!r.ok) {
        return {
          status: 'queda',
          motivo: 'erro_http',
          detalhe: `${r.status} ${texto.slice(0, 200)}`,
          ...base(),
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
          ...base(),
          ...semGasto,
        };
      }
      const lida = lerRespostaDoJev(corpo, input.opcoes);
      if (lida.status !== 'ok') {
        return {
          status: 'queda',
          motivo: lida.status,
          detalhe: lida.detalhe,
          ...base(),
          ...semGasto,
        };
      }
      const seguro = lida.confianca >= cfg.limiar;
      return {
        status: 'decidido',
        resposta: {
          ...lida,
          escolha: seguro ? lida.escolha : RESPONDER_SEM_FERRAMENTA,
          // Laya local não cobra, mesmo que a resposta traga `usage.cost`.
          custoUsd: null,
        },
        ...base(),
      };
    } catch (erro) {
      const nome = (erro as Error).name;
      return {
        status: 'queda',
        motivo:
          nome === 'TimeoutError' || nome === 'AbortError'
            ? 'timeout'
            : 'erro_de_rede',
        // Só o NOME do erro: a mensagem de rede pode carregar a URL.
        detalhe: nome,
        ...base(),
        ...semGasto,
      };
    }
  }
}
