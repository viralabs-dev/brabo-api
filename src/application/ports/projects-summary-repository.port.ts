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
  roster: RosterFacts;
}

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
}
