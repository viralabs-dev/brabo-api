import { Injectable, Logger } from '@nestjs/common';
import type { ChatMessage, LLMProviderName, ToolDef } from '@brabo/shared';
import { ProjectRepository } from '../../ports/project-repository.port';
import { WorkspaceRepository } from '../../ports/workspace-repository.port';
import { TokenEstimator } from '../../ports/token-estimator.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ToolRouter } from '../../ports/tool-router.port';
import { RecordLlmUsageUseCase } from './record-llm-usage.use-case';
import {
  AGENTES_FORA_DO_ROTEAMENTO,
  MODELO_DO_JEV,
  ORIGEM_DA_QUEDA,
  TETO_DO_ESTADO_EM_TOKENS,
  menuP3,
  microUsdDe,
  montarPedidoAoJev,
  precoImplicitoPorMilhao,
  recortarEstado,
  temColisaoDeNome,
  type EstadoParaOJev,
  type MotivoDaQueda,
  type OrigemDaQueda,
} from '../../../domain/llm/tool-router';

export interface DecidirFerramentaDoPassoInput {
  projectId: string;
  sessionId: string;
  agentId?: string;
  provider: LLMProviderName;
  apiKey?: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  /**
   * O caminho para o agente pedir o catálogo inteiro quando o menu estava
   * errado (ADR 0179): o engine repete o passo com isto ligado. Não chama o Jev.
   */
  catalogoCompleto?: boolean;
}

/** O que a api devolve ao engine sobre o passo roteado — vira `tool_router.decided` lá. */
export interface ToolRouting {
  modelo: string;
  /** Quantas ferramentas o agente tinha neste passo. */
  ofertadas: number;
  /** Os nomes, antes e depois: o registro por passo da AT-239. */
  menuAntes: string[];
  menuDepois: string[];
  escolha: string | null;
  confianca: number | null;
  segunda: { opcao: string; probabilidade: number } | null;
  anterior: string | null;
  /** O Jev respondeu E o cardápio ficou menor que o catálogo. */
  aplicado: boolean;
  motivoDaQueda: MotivoDaQueda | null;
  origemDaQueda: OrigemDaQueda | null;
  detalheDaQueda: string | null;
  latenciaMs: number;
  /** Custo REAL da resposta (`usage.cost`), em micro-USD; o engine o soma ao orçamento local do laço. */
  custoMicros: number;
  /** `true` quando o Jev cobrou mas a linha de `token_usage` não pôde ser gravada. */
  gastoNaoRegistrado: boolean;
}

/** As condições passaram: o roteador vai ser consultado. */
export interface PlanoDoRoteamento {
  tools: ToolDef[];
  apiKey: string;
  agentId: string;
}

export interface DecisaoDoPasso {
  /** As ferramentas que o provider de chat recebe (o catálogo inteiro em qualquer queda). */
  tools: ToolDef[] | undefined;
  toolRouting: ToolRouting | null;
}

/**
 * O passo em que o Jev escolhe a ferramenta (AT-238, ADR 0179, RN-625). Chamado
 * pelos DOIS casos de uso de turno (`RunLlmTurnUseCase` e
 * `StreamLlmTurnUseCase`) entre a resolução do provider e o `provider.chat`,
 * porque os dois já duplicam o fluxo e um terceiro lugar seria a terceira cópia.
 *
 * O Jev só RESTRINGE o cardápio (política P3). Ele não aprova, não nega e não
 * escolhe modelo: a ferramenta que sobra continua virando Proposed Action e
 * passando pela política como sempre. E o turno NUNCA falha por causa dele —
 * `executar` não lança: toda falha devolve o catálogo inteiro com o motivo.
 */
@Injectable()
export class DecidirFerramentaDoPassoUseCase {
  private readonly logger = new Logger(DecidirFerramentaDoPassoUseCase.name);

  constructor(
    private readonly projects: ProjectRepository,
    private readonly workspaces: WorkspaceRepository,
    private readonly router: ToolRouter,
    private readonly tokenEstimator: TokenEstimator,
    private readonly unitOfWork: UnitOfWork,
    private readonly recordLlmUsage: RecordLlmUsageUseCase,
  ) {}

  /**
   * As condições, nesta ordem (nenhuma gera evento quando falha — o evento
   * existe para medir o roteamento, não para poluir o log de todo turno):
   * (a) provider do turno é `openrouter`, com credencial; (b) o pedido traz
   * duas ou mais ferramentas; (c) há agente, e não é um dos fora do
   * roteamento; (d) o engine não pediu o catálogo inteiro; (e) o workspace não
   * desligou. `null` = não roteia. A leitura do workspace vai por último para
   * que provider ≠ openrouter não custe nenhuma consulta.
   */
  async preparar(
    input: DecidirFerramentaDoPassoInput,
  ): Promise<PlanoDoRoteamento | null> {
    try {
      if (input.provider !== 'openrouter' || !input.apiKey) return null;
      const tools = input.tools ?? [];
      if (tools.length < 2) return null;
      if (!input.agentId || AGENTES_FORA_DO_ROTEAMENTO.has(input.agentId)) {
        return null;
      }
      if (input.catalogoCompleto) return null;
      const projeto = await this.projects.findById(input.projectId);
      if (!projeto) return null;
      const workspace = await this.workspaces.findById(projeto.workspaceId);
      if (!workspace?.toolRouterEnabled) return null;
      return { tools, apiKey: input.apiKey, agentId: input.agentId };
    } catch (erro) {
      // Ler a flag que falha não derruba o turno: sem Jev, como antes.
      this.logger.warn(
        `roteamento de ferramenta não consultado: ${(erro as Error).message}`,
      );
      return null;
    }
  }

  /** `preparar` + `executar` para quem não narra o início (o turno não streamado). */
  async decidir(input: DecidirFerramentaDoPassoInput): Promise<DecisaoDoPasso> {
    const plano = await this.preparar(input);
    return plano
      ? this.executar(plano, input)
      : { tools: input.tools, toolRouting: null };
  }

  async executar(
    plano: PlanoDoRoteamento,
    input: DecidirFerramentaDoPassoInput,
  ): Promise<DecisaoDoPasso> {
    const nomes = plano.tools.map((t) => t.name);
    const base = {
      modelo: MODELO_DO_JEV,
      ofertadas: nomes.length,
      menuAntes: nomes,
      menuDepois: nomes,
      escolha: null,
      confianca: null,
      segunda: null,
      aplicado: false,
      motivoDaQueda: null,
      origemDaQueda: null,
      detalheDaQueda: null,
      latenciaMs: 0,
      custoMicros: 0,
      gastoNaoRegistrado: false,
    } satisfies Omit<ToolRouting, 'anterior'>;

    const queda = (
      motivo: MotivoDaQueda,
      detalhe: string | null,
      anterior: string | null,
      extra: Partial<ToolRouting> = {},
    ): DecisaoDoPasso => ({
      tools: plano.tools,
      toolRouting: {
        ...base,
        anterior,
        motivoDaQueda: motivo,
        origemDaQueda: ORIGEM_DA_QUEDA[motivo],
        detalheDaQueda: detalhe,
        ...extra,
      },
    });

    try {
      if (temColisaoDeNome(plano.tools)) {
        return queda('colisao_de_nome', null, null);
      }
      const { estado, anterior } = recortarEstado(
        plano.agentId,
        input.messages,
      );
      const pedido = montarPedidoAoJev(estado, plano.tools);
      if (
        this.tokenEstimator.count(JSON.stringify(pedido)) >
        TETO_DO_ESTADO_EM_TOKENS
      ) {
        return queda('estado_grande', null, anterior);
      }

      const r = await this.router.decidir({
        apiKey: plano.apiKey,
        pedido,
        opcoes: nomes,
      });

      const custoUsd =
        r.status === 'decidido' ? r.resposta.custoUsd : r.custoUsd;
      const tokensIn =
        r.status === 'decidido'
          ? r.resposta.tokensDeEntrada
          : r.tokensDeEntrada;
      const tokensOut =
        r.status === 'decidido' ? r.resposta.tokensDeSaida : r.tokensDeSaida;
      const custoMicros = microUsdDe(custoUsd);
      const gastoNaoRegistrado = !(await this.registrarGasto({
        input,
        agentId: plano.agentId,
        estado,
        pedidoJson: JSON.stringify(pedido),
        custoUsd,
        custoMicros,
        tokensIn,
        tokensOut,
        latenciaMs: r.latenciaMs,
      }));

      if (r.status === 'queda') {
        return queda(r.motivo, r.detalhe, anterior, {
          latenciaMs: r.latenciaMs,
          custoMicros,
          gastoNaoRegistrado,
        });
      }

      const menu = menuP3(nomes, r.resposta.escolha, anterior);
      const efetivas = plano.tools.filter((t) => menu.includes(t.name));
      const segunda = Object.entries(r.resposta.probabilidades)
        .filter(([opcao]) => opcao !== r.resposta.escolha)
        .sort((a, b) => b[1] - a[1])[0];
      return {
        tools: efetivas,
        toolRouting: {
          ...base,
          menuDepois: efetivas.map((t) => t.name),
          escolha: r.resposta.escolha,
          confianca: r.resposta.confianca,
          segunda: segunda
            ? { opcao: segunda[0], probabilidade: segunda[1] }
            : null,
          anterior,
          aplicado: efetivas.length < plano.tools.length,
          latenciaMs: r.latenciaMs,
          custoMicros,
          gastoNaoRegistrado,
        },
      };
    } catch (erro) {
      // Defesa final: nada daqui derruba o turno. É `codigo` porque o
      // adaptador nunca lança e o restante é lógica nossa.
      this.logger.warn(
        `roteamento de ferramenta falhou: ${(erro as Error).message}`,
      );
      return queda(
        'resposta_invalida',
        `interno: ${(erro as Error).name}`,
        null,
        {
          origemDaQueda: 'codigo',
        },
      );
    }
  }

  /**
   * Uma linha de `token_usage` com o custo REAL da resposta (`estimated =
   * false`), no ator do PRÓPRIO agente — assim o gasto entra no orçamento de
   * área (ADR 0110) — e o Jev distinguido por `modelName`. Só quando o
   * OpenRouter devolveu `usage.cost`: sem ele não há custo real a gravar, e a
   * lacuna (timeout que ainda assim cobrou) está declarada na RN-625.
   */
  private async registrarGasto(a: {
    input: DecidirFerramentaDoPassoInput;
    agentId: string;
    estado: EstadoParaOJev;
    pedidoJson: string;
    custoUsd: number | null;
    custoMicros: number;
    tokensIn: number | null;
    tokensOut: number | null;
    latenciaMs: number;
  }): Promise<boolean> {
    if (a.custoUsd === null) return true;
    try {
      const estimated = a.tokensIn === null;
      const inputTokens = a.tokensIn ?? this.tokenEstimator.count(a.pedidoJson);
      const outputTokens = a.tokensOut ?? 0;
      const preco = precoImplicitoPorMilhao(
        a.custoMicros,
        inputTokens + outputTokens,
      );
      await this.unitOfWork.runInTransaction(async () => {
        await this.recordLlmUsage.execute({
          projectId: a.input.projectId,
          sessionId: a.input.sessionId,
          actor: { kind: 'agent', id: a.agentId },
          provider: 'openrouter',
          modelId: null,
          modelName: MODELO_DO_JEV,
          inputTokens,
          outputTokens,
          estimated,
          costMicros: a.custoMicros,
          inputPricePerMillionMicros: preco,
          outputPricePerMillionMicros: preco,
          priceImplicit: true,
          latencyMs: a.latenciaMs,
          bindingOrigin: null,
          upstreamProvider: null,
          routingPreference: null,
        });
      });
      return true;
    } catch (erro) {
      this.logger.error(
        `gasto do Jev não registrado (${a.custoMicros} micro-USD): ${(erro as Error).message}`,
      );
      return false;
    }
  }
}
