import type { GitProviderName } from '@brabo/shared';
import type { ProvisioningStatus } from '../../domain/git/repo-bootstrap-status';
import type { SessionEvent } from '../../domain/sessions/session-event.entity';

/**
 * FATOS do event log que decidem QUEM aparece na roster de agentes de um
 * projeto — nunca a roster montada.
 *
 * A fronteira é deliberada. Quem é o lead de uma área, qual ícone/cor cada
 * agente tem e como os membros se agrupam num chip é catálogo de APRESENTAÇÃO,
 * e mora em `apps/web/src/lib/agents.ts` (hardcoded por corte de escopo da
 * Fase 8, registrado no schema). A api responde só o que aconteceu; o web
 * decide o que se desenha com isso. Duplicar o catálogo aqui criaria duas
 * fontes de verdade para a mesma tela.
 *
 * `gatesEverOpened` e `delegatedSubagents` cobrem a sessão INTEIRA, não uma
 * janela dos últimos N eventos — é o que o comentário de `deriveAgentRoster`
 * sempre disse querer ("já abriu alguma vez", "delegação registrada nesta
 * sessão") e o que o cliente não conseguia enxergar quando a sessão passava
 * de 200 eventos (ADR 0021).
 */
export interface RosterFacts {
  executionActivated: boolean;
  moduleNames: string[];
  gatesEverOpened: boolean;
  delegatedSubagents: string[];
  infraActive: boolean;
  /** ADR 0087 — mesmo critério de `infraActive`: handoff `accepted` para "ux-designer". */
  uxDesignerActive: boolean;
  /** Staff (docs/fluxo.yml, ADR 0088) — mesmo critério de `infraActive`. */
  staffActive: boolean;
}

/** Tudo que UM card do dashboard precisa para renderizar. */
export interface ProjectCardSummary {
  projectId: string;
  /** `local` quando o projeto ainda não tem repositório provisionado. */
  provider: GitProviderName;
  provisioningStatus: ProvisioningStatus | null;
  /**
   * `null` quando o projeto nunca teve orçamento definido — distinto de uma
   * linha zerada, e é o que faz o card oferecer "Definir orçamento".
   */
  budget: { limitMicros: number; spentMicros: number } | null;
  latestSessionId: string | null;
  /** `nextSeq - 1` da sessão mais recente; 0 quando não há sessão. */
  latestSeq: number;
  /** Último evento da sessão mais recente — a linha de rodapé do card. */
  lastEvent: SessionEvent | null;
  storiesAwaitingPromotion: number;
  /**
   * `proposed_actions` com `status = 'pending'` no projeto INTEIRO, todas as
   * sessões — não só a mais recente (RN-151). É o número que a sidebar
   * (`Shell.tsx`) mostra: antes ela reusava `latestSeq - seen` (atividade não
   * lida), que misturava qualquer evento com decisão pendente de verdade. A
   * aba Aprovações mostra só as da sessão mais recente; aqui é o projeto todo
   * de propósito, porque o badge é por PROJETO, não por sessão.
   */
  pendingApprovalsCount: number;
  roster: RosterFacts;
}

/**
 * Onde a leitura de UM projeto parou, do ponto de vista de UM navegador.
 *
 * `afterSeq` sai do `localStorage` de quem está olhando (`read-state` no web):
 * não existe "marcar como lido" no servidor, e é exatamente por isso que a
 * gaveta do sino precisa MANDAR o corte em vez de o servidor deduzi-lo. Zero
 * significa "nunca vi nada neste projeto".
 */
export interface UnreadCursor {
  projectId: string;
  afterSeq: number;
}

/**
 * Os eventos não lidos de um projeto, na sessão mais recente dele — do MAIS
 * RECENTE para o mais antigo (RN-100).
 */
export interface ProjectUnreadEvents {
  projectId: string;
  sessionId: string;
  /** Ordem decrescente por `seq`: o primeiro item é o evento mais novo. */
  events: SessionEvent[];
}

/**
 * Teto de eventos devolvidos POR PROJETO.
 *
 * É o mesmo `DEFAULT_LIMIT` que `GET .../events` aplica quando o chamador não
 * pede limite — a gaveta chamava exatamente assim, então repetir o número aqui
 * é o que mantém a resposta idêntica à do caminho antigo. Sem ele, um projeto
 * abandonado por semanas devolveria a sessão inteira e a chamada em lote
 * ficaria mais cara que as N que ela substitui.
 *
 * O teto é o motivo de a ORDEM ser do SQL (RN-100): ele decide QUAIS 50
 * eventos sobrevivem, e a resposta é uma JANELA — os 50 mais recentes não
 * lidos, não os 50 primeiros. Quem chama sabe quantos ficaram de fora sem
 * perguntar de novo: `latestSeq` menos o corte é o total de não lidos, e o
 * resto é subtração.
 */
export const UNREAD_EVENTS_POR_PROJETO = 50;

/**
 * Read model do dashboard: uma projeção que atravessa agregados (git,
 * orçamento, sessão, backlog, arquitetura) para responder a GRADE INTEIRA de
 * cards numa chamada só.
 *
 * Port próprio, e não mais um método em cada repositório existente, porque o
 * que está sendo modelado é a TELA, não um agregado — e porque o custo tem de
 * ficar visível num lugar só: cada método aqui é uma consulta escopada por
 * workspace cujo número de idas ao banco NÃO cresce com a quantidade de
 * projetos. Um `for (const projeto of projetos)` dentro desta implementação
 * seria trocar N+1 de HTTP por N+1 de SQL, que é o mesmo defeito num andar
 * mais barato.
 */
export abstract class ProjectsSummaryRepository {
  abstract summarizeForWorkspace(
    workspaceId: string,
  ): Promise<ProjectCardSummary[]>;

  /**
   * O conteúdo da gaveta do sino, para TODOS os projetos de uma vez.
   *
   * Metade que faltava do read model acima (RN-091). O resumo já responde
   * QUANTOS não lidos cada projeto tem — `latestSeq` menos o que o navegador
   * viu —, mas QUAIS eventos são esses continuava saindo de uma requisição por
   * projeto, porque o corte é um `seq` que só o navegador conhece. Mandar o
   * mapa `projeto → afterSeq` no corpo resolve sem mudar nem a frescura nem o
   * conteúdo: é batelamento puro.
   *
   * Contrato:
   * - lista de cursores VAZIA devolve lista vazia, e sem tocar no banco.
   *   "Não perguntei nada" não é "me dê tudo";
   * - projeto fora de `workspaceId` é IGNORADO, não erro: o cursor vem do
   *   `localStorage` de quem chama, que pode ter lixo de um workspace antigo;
   * - projeto sem sessão, ou sem evento novo depois do corte, sai da resposta
   *   em vez de aparecer com lista vazia;
   * - a sessão consultada é a MAIS RECENTE do projeto, a mesma que
   *   `summarizeForWorkspace` reporta em `latestSessionId`;
   * - os eventos vêm do MAIS RECENTE para o mais antigo, e quando há mais que
   *   `UNREAD_EVENTS_POR_PROJETO` não lidos os que sobrevivem ao teto são os
   *   mais NOVOS (RN-100).
   */
  abstract unreadEventsForWorkspace(
    workspaceId: string,
    cursors: UnreadCursor[],
  ): Promise<ProjectUnreadEvents[]>;
}
