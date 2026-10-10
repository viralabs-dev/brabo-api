/**
 * O roteamento de ferramenta pelo Jev (AT-238, ADR 0179, RN-625) — a parte PURA:
 * o pedido ao Decisions API, a leitura da resposta, o recorte do `state` e a
 * política de menu. Nada aqui toca a rede nem o banco.
 *
 * O formato do pedido e da resposta é o MEDIDO em `scripts/jev/jev.ts`
 * (2026-09-29), não o da nota do épico: `questions` é um OBJETO chaveado pelo
 * id da pergunta.
 *
 *   POST https://openrouter.ai/api/alpha/decisions
 *   { model, state, questions: { <id>: { type: "choice", instructions, criteria } } }
 *   → { model, id, answers: { <id>: { type, choice, probabilities, confidence } },
 *       usage: { input_tokens, output_tokens, cost } }
 */
import type { ChatMessage, ToolDef } from '@brabo/shared';

export const ENDPOINT_DO_JEV = 'https://openrouter.ai/api/alpha/decisions';
/** Pin (AT-236 resposta 5): o bump é por PR, nunca por alias. */
export const MODELO_DO_JEV = 'typesafe/jev-1.13';
export const PERGUNTA_DO_JEV = 'ferramenta_do_passo';
export const RESPONDER_SEM_FERRAMENTA = 'responder_sem_ferramenta';
export const DESCRICAO_SEM_FERRAMENTA =
  'Nenhuma ferramenta: responder ao usuário em texto ou encerrar o turno.';
export const INSTRUCAO_DO_JEV =
  'Qual ferramenta o agente deve chamar neste passo, dado o pedido, o contexto e os passos recentes? ' +
  `Escolha "${RESPONDER_SEM_FERRAMENTA}" se o agente deve responder em texto ou encerrar o turno.`;

/** AT-235 ("N = 6, cada texto cortado em 500"), como medido em `scripts/jev/passos.ts`. */
export const PASSOS_RECENTES = 6;
export const CORTE_DO_PASSO = 500;
export const CORTE_DO_CONTEXTO = 1500;
/** Só guarda contra o extremo: o `pedido` medido (a mensagem inicial do laço) não era cortado. */
export const CORTE_DO_PEDIDO = 6000;
/** Um quarto da janela de 32 mil do Jev (AT-235); estourou → queda `estado_grande`. */
export const TETO_DO_ESTADO_EM_TOKENS = 8000;

/** Agentes que NUNCA são roteados: a Anamnese está pausada (fora do escopo da AT-238). */
export const AGENTES_FORA_DO_ROTEAMENTO: ReadonlySet<string> = new Set([
  'anamnese',
  'context-manager',
]);

export type MotivoDaQueda =
  | 'timeout'
  | 'erro_http'
  | 'erro_de_rede'
  | 'resposta_invalida'
  | 'escolha_fora_das_opcoes'
  | 'estado_grande'
  | 'colisao_de_nome';

/** A origem da queda no vocabulário da RN-059: quem falhou. */
export type OrigemDaQueda = 'infra' | 'modelo' | 'codigo';

export const ORIGEM_DA_QUEDA: Record<MotivoDaQueda, OrigemDaQueda> = {
  timeout: 'infra',
  erro_http: 'infra',
  erro_de_rede: 'infra',
  resposta_invalida: 'modelo',
  escolha_fora_das_opcoes: 'modelo',
  estado_grande: 'codigo',
  colisao_de_nome: 'codigo',
};

export interface EstadoParaOJev {
  agente: string;
  pedido: string;
  contexto: string;
  passos_recentes: {
    ferramenta: string;
    argumentos: string;
    resultado: string;
  }[];
}

export interface PedidoAoJev {
  model: string;
  state: EstadoParaOJev;
  questions: Record<
    string,
    {
      type: 'choice';
      instructions: string;
      criteria: Record<string, string>;
    }
  >;
}

export function cortar(texto: string, teto: number): string {
  return texto.length <= teto
    ? texto
    : `${texto.slice(0, teto)}…[+${texto.length - teto}]`;
}

/** Há ferramenta do catálogo com o nome reservado? Então o roteador não é consultado. */
export function temColisaoDeNome(tools: readonly ToolDef[]): boolean {
  return tools.some((t) => t.name === RESPONDER_SEM_FERRAMENTA);
}

/** `criteria` = `{ nome: descrição }` do catálogo do passo + a opção reservada. Nunca `parameters`: o Jev escolhe, não preenche. */
export function montarPedidoAoJev(
  state: EstadoParaOJev,
  tools: readonly ToolDef[],
): PedidoAoJev {
  const criteria: Record<string, string> = {};
  for (const t of tools) criteria[t.name] = t.description || t.name;
  criteria[RESPONDER_SEM_FERRAMENTA] = DESCRICAO_SEM_FERRAMENTA;
  return {
    model: MODELO_DO_JEV,
    state,
    questions: {
      [PERGUNTA_DO_JEV]: {
        type: 'choice',
        instructions: INSTRUCAO_DO_JEV,
        criteria,
      },
    },
  };
}

export type RespostaDoJev =
  | {
      status: 'ok';
      escolha: string;
      confianca: number;
      probabilidades: Record<string, number>;
      /** Custo REAL da resposta, em USD (`usage.cost`); `null` se não veio. */
      custoUsd: number | null;
      tokensDeEntrada: number | null;
      tokensDeSaida: number | null;
    }
  | {
      status: 'resposta_invalida' | 'escolha_fora_das_opcoes';
      detalhe: string;
      /** O custo pode ter vindo mesmo assim: o OpenRouter cobrou. */
      custoUsd: number | null;
      tokensDeEntrada: number | null;
      tokensDeSaida: number | null;
    };

/** A forma que o Decisions API devolve — tudo `unknown` até ser lido. */
interface CorpoDaResposta {
  answers?: Record<
    string,
    { choice?: unknown; confidence?: unknown; probabilities?: unknown }
  >;
  usage?: { cost?: unknown; input_tokens?: unknown; output_tokens?: unknown };
}

function comoCorpo(corpo: unknown): CorpoDaResposta | null {
  return typeof corpo === 'object' && corpo !== null ? corpo : null;
}

const numero = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** Qualquer desvio de forma vira queda NOMEADA, nunca exceção que suba (AT-235). */
export function lerRespostaDoJev(
  corpo: unknown,
  opcoes: readonly string[],
): RespostaDoJev {
  const c = comoCorpo(corpo);
  const custo = {
    custoUsd: numero(c?.usage?.cost),
    tokensDeEntrada: numero(c?.usage?.input_tokens),
    tokensDeSaida: numero(c?.usage?.output_tokens),
  };
  const a = c?.answers?.[PERGUNTA_DO_JEV];
  if (!a || typeof a.choice !== 'string' || numero(a.confidence) === null) {
    return {
      status: 'resposta_invalida',
      detalhe: (JSON.stringify(corpo) ?? 'vazio').slice(0, 300),
      ...custo,
    };
  }
  if (![...opcoes, RESPONDER_SEM_FERRAMENTA].includes(a.choice)) {
    return { status: 'escolha_fora_das_opcoes', detalhe: a.choice, ...custo };
  }
  const probabilidades: Record<string, number> = {};
  if (a.probabilities && typeof a.probabilities === 'object') {
    for (const [k, v] of Object.entries(
      a.probabilities as Record<string, unknown>,
    )) {
      if (typeof v === 'number') probabilidades[k] = v;
    }
  }
  return {
    status: 'ok',
    escolha: a.choice,
    confianca: a.confidence as number,
    probabilidades,
    ...custo,
  };
}

/**
 * O `state` que o produto realmente tem ANTES do passo, recortado das
 * `messages` que o engine já manda (sem leitura de banco):
 *  - `agente`: o `agentId` do turno;
 *  - `contexto`: o começo da PRIMEIRA mensagem `system` (identidade e estado);
 *  - `pedido`: a última mensagem `user` (a mensagem inicial do laço nos agentes
 *    de execução; a fala da pessoa nos conversacionais);
 *  - `passos_recentes`: as chamadas de ferramenta DEPOIS dessa mensagem — a
 *    execução corrente, porque o laço recomeça a cada `run` —, uma entrada por
 *    chamada, as 6 últimas, argumento e resultado cortados em 500 caracteres.
 * Nada do passo-alvo entra: a resposta do modelo ainda não existe.
 */
export function recortarEstado(
  agente: string,
  messages: readonly ChatMessage[],
): { estado: EstadoParaOJev; anterior: string | null } {
  const sistema = messages.find((m) => m.role === 'system');
  let idxPedido = -1;
  messages.forEach((m, i) => {
    if (m.role === 'user') idxPedido = i;
  });
  const execucao = idxPedido >= 0 ? messages.slice(idxPedido + 1) : messages;
  const resultados = new Map<string, string>();
  for (const m of execucao) {
    if (m.role === 'tool' && m.toolCallId) {
      resultados.set(m.toolCallId, m.content);
    }
  }
  const entradas: EstadoParaOJev['passos_recentes'] = [];
  for (const m of execucao) {
    if (m.role !== 'assistant') continue;
    for (const c of m.toolCalls ?? []) {
      const r = resultados.get(c.id);
      entradas.push({
        ferramenta: c.name,
        argumentos: cortar(JSON.stringify(c.arguments ?? {}), CORTE_DO_PASSO),
        resultado:
          r === undefined
            ? '(sem resultado gravado)'
            : cortar(r, CORTE_DO_PASSO),
      });
    }
  }
  return {
    estado: {
      agente,
      pedido: cortar(
        idxPedido >= 0 ? messages[idxPedido].content : '',
        CORTE_DO_PEDIDO,
      ),
      contexto: cortar(sistema?.content ?? '', CORTE_DO_CONTEXTO),
      passos_recentes: entradas.slice(-PASSOS_RECENTES),
    },
    anterior: entradas.at(-1)?.ferramenta ?? null,
  };
}

/**
 * A política P3 (medição de 2026-09-29, `scripts/jev/menu.ts`): o menu é
 * {escolha do Jev, ferramenta anterior da mesma execução}. O Jev só RESTRINGE
 * (AT-236): se ele disser `responder_sem_ferramenta`, ou não houver ferramenta
 * anterior no catálogo, o catálogo inteiro segue. Nunca vazio, sempre
 * subconjunto do catálogo, na ordem do catálogo.
 */
export function menuP3(
  catalogo: readonly string[],
  escolha: string,
  anterior: string | null,
): string[] {
  const dentro = new Set(catalogo);
  const anteriorNoCatalogo =
    anterior !== null && dentro.has(anterior) ? anterior : null;
  if (escolha === RESPONDER_SEM_FERRAMENTA || anteriorNoCatalogo === null) {
    return [...catalogo];
  }
  const menu = new Set([escolha, anteriorNoCatalogo]);
  const filtrado = catalogo.filter((n) => menu.has(n));
  return filtrado.length === 0 ? [...catalogo] : filtrado;
}

/** Micro-USD inteiro a partir do `usage.cost` (USD) da resposta. */
export function microUsdDe(custoUsd: number | null): number {
  return custoUsd === null ? 0 : Math.round(custoUsd * 1_000_000);
}

/**
 * O preço por milhão IMPLÍCITO (AT-236 resposta 11): o Jev não tem preço de
 * catálogo, então o preço é `custo ÷ tokens` da própria resposta — mantém
 * `tokens × preço = custo` (RN-044). Sem tokens, 0.
 */
export function precoImplicitoPorMilhao(
  costMicros: number,
  tokens: number,
): number {
  return tokens > 0 ? Math.round((costMicros / tokens) * 1_000_000) : 0;
}

/**
 * O PISO do menu (AT-445, RN-758): ferramentas de OBRIGAÇÃO do agente que o
 * recorte do Jev nunca tira. Sem elas o agente lia a ausência como
 * incapacidade — o PO sem `create_task` fechava com histórias sem tarefa, o
 * Arquiteto sem as de artefato fechava sem roteamento, contratos, ADR nem C4.
 * É uma lista ESTÁTICA por agente: a api não tem sinal barato de qual
 * obrigação está pendente neste passo, então o piso vale sempre que o menu é
 * recortado. Só entra o que está no catálogo do passo — o piso nunca
 * acrescenta ferramenta que o agente não tinha (P3 intacto).
 */
export const PISO_DO_MENU: Readonly<Record<string, readonly string[]>> = {
  po: ['create_story', 'create_task'],
  arquiteto: [
    'create_module_map',
    // Obrigações do kickoff do Arquiteto que faltavam (AT-481, RN-809): sem
    // elas ele encerrava dizendo que a ferramenta "não está disponível nesta
    // etapa", com histórias sem módulo e imagem nunca decidida.
    'assign_story_modules',
    'choose_project_image',
    'route_modules_to_infra',
    'declare_module_contracts',
    'propose_adr',
    'create_c4_diagram',
    // Leituras de ESTADO (AT-460, RN-784, decisão do dono): sem elas o
    // Arquiteto afirmava ADR "pendente" e backlog "sem tarefas" de memória.
    'listar_adrs_propostas',
    'listar_backlog',
  ],
};
/**
 * Os dev agents ficam SEM piso, de propósito: a obrigação deles muda a cada
 * passo (ler, editar, testar) e um piso fixo desfaria o recorte. Para eles vale
 * só o aviso de recorte (RN-759).
 */
export function pisoDoMenu(agentId: string): readonly string[] {
  return PISO_DO_MENU[agentId] ?? [];
}

/** O menu P3 com o piso do agente somado, na ordem do catálogo. */
export function menuComPiso(
  catalogo: readonly string[],
  menu: readonly string[],
  agentId: string,
): string[] {
  const dentro = new Set([...menu, ...pisoDoMenu(agentId)]);
  return catalogo.filter((n) => dentro.has(n));
}

/**
 * A mensagem `system` EFÊMERA do passo recortado (AT-445, RN-759): vai só na
 * chamada ao provider deste passo, nunca no histórico. Diz que o menu é um
 * RECORTE do passo, e não o que o agente sabe fazer.
 */
export function avisoDeRecorte(
  menuDepois: readonly string[],
  ocultas: number,
): ChatMessage {
  return {
    role: 'system',
    content:
      `Neste passo você recebeu um recorte de ${menuDepois.length} das suas ferramentas ` +
      `(${menuDepois.join(', ')}); as outras ${ocultas} seguem disponíveis e voltam ` +
      'nas próximas voltas deste turno. Não conclua que não tem uma ferramenta ' +
      'por ela não estar neste recorte, nem encerre o turno esperando por ela: ' +
      'faça o passo atual e ela volta no seguinte.',
  };
}
