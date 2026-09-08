import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  ContainersOverviewRepository,
  type ContainerOverviewRow,
} from '../../../application/ports/containers-overview-repository.port';
import {
  EVENTO_IMAGEM_DO_PROJETO,
  decisaoNaVersao,
} from '../../../domain/containers/project-container';
import type { ProjectContainerLifecycle } from '../../../domain/containers/container-lifecycle';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';
import {
  projectContainers,
  projects,
  proposedActions,
  sessionEvents,
  sessions,
} from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

const TIPOS_DE_ACAO_DE_CONTAINER = [
  'container_start',
  'container_stop',
  'container_remove',
  // RN-521: a tela passou a propor este tipo para projeto `runner`, então ele
  // entra aqui pelo mesmo motivo que os outros três — sem isto, a proposta
  // feita pela própria página não voltaria como `acaoPendente` e a linha
  // ofereceria "Subir" de novo em cima de uma decisão já aberta.
  'container_start_via_runner',
] as const;

function toLifecycle(
  row: typeof projectContainers.$inferSelect,
): ProjectContainerLifecycle {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    imageVersion: row.imageVersion,
    containerId: row.containerId,
    resources: {
      cpus: row.cpus,
      memoryMb: row.memoryMb,
      pidsLimit: row.pidsLimit,
    },
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    statusChangedAt: row.statusChangedAt,
  };
}

function toProposedAction(
  row: typeof proposedActions.$inferSelect,
): ProposedAction {
  return {
    id: row.id,
    projectId: row.projectId,
    sessionId: row.sessionId,
    seq: row.seq,
    actionType: row.actionType,
    payload: row.payload,
    status: row.status,
    resolvedPolicy: row.resolvedPolicy,
    actor: { kind: row.actorKind, id: row.actorId },
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    rejectionReason: row.rejectionReason,
    executionResult: row.executionResult,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Read model da página global de containers (ADR 0136, RN-495/RN-521) — TRÊS
 * consultas, quantos projetos forem, mesmo espírito de
 * `DrizzleProjectsSummaryRepository`.
 */
@Injectable()
export class DrizzleContainersOverviewRepository implements ContainersOverviewRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async listForWorkspace(workspaceId: string): Promise<ContainerOverviewRow[]> {
    const db = currentDb(this.rootDb);

    // LEFT JOIN desde a RN-521 (era INNER): TODO projeto do workspace entra,
    // tenha ele linha de ciclo de vida ou não. A régua antiga ("só quem já
    // tem `project_containers`") era exatamente o que escondia da tela o
    // projeto cuja PRIMEIRA subida falhou antes de registrar coisa nenhuma —
    // e esse era o único projeto para o qual a tela precisava existir.
    //
    // Ordenado por nome no SQL, não no cliente: sem `ORDER BY`, a lista de um
    // workspace inteiro passaria a ter ordem de heap, que muda a cada
    // `VACUUM`. Com o INNER JOIN e um punhado de linhas isso não aparecia.
    const linhas = await db
      .select({
        projectId: projects.id,
        projectName: projects.name,
        projectSlug: projects.slug,
        executionMode: projects.executionMode,
        workspaceVerifiedAt: projects.workspaceVerifiedAt,
        container: projectContainers,
      })
      .from(projects)
      .leftJoin(projectContainers, eq(projectContainers.projectId, projects.id))
      .where(eq(projects.workspaceId, workspaceId))
      .orderBy(asc(projects.name), asc(projects.id));

    if (linhas.length === 0) return [];

    const projectIds = linhas.map((l) => l.projectId);

    // Em lote: os eventos `artifact.project_image` de TODOS os projetos
    // encontrados, para DOIS usos — resolver a imagem-texto de cada
    // `imageVersion` congelado (`decisaoNaVersao`,
    // domain/containers/project-container.ts) e responder se o projeto TEM
    // decisão de imagem (o portão da RN-105, que a tela consulta antes de
    // oferecer o botão de subir).
    // `session_events` não tem `project_id` — o artefato do Arquiteto vive
    // sob uma SESSÃO — então o join por `sessions.project_id` é EXPLÍCITO
    // aqui, o mesmo que `DrizzleSessionEventRepository.listByTypeForProject`
    // já faz por projeto único (`session-event.repository.ts`).
    const eventosDeImagem = await db
      .select({
        projectId: sessions.projectId,
        payload: sessionEvents.payload,
      })
      .from(sessionEvents)
      .innerJoin(sessions, eq(sessionEvents.sessionId, sessions.id))
      .where(
        and(
          inArray(sessions.projectId, projectIds),
          eq(sessionEvents.type, EVENTO_IMAGEM_DO_PROJETO),
        ),
      );

    const eventosPorProjeto = new Map<
      string,
      { projectId: string; payload: unknown }[]
    >();
    for (const evento of eventosDeImagem) {
      const lista = eventosPorProjeto.get(evento.projectId) ?? [];
      lista.push(evento);
      eventosPorProjeto.set(evento.projectId, lista);
    }

    // Em lote: as `proposed_actions` PENDENTES de container dos mesmos
    // projetos, em QUALQUER sessão deles — mesmo cruzamento project-wide de
    // `ListProjectPendingActionsUseCase`. A tela usa isto pra trocar o botão
    // de ação pelo `ApprovalCard` inline, no molde de `ProjectPrsTab`.
    const acoesPendentes = await db
      .select()
      .from(proposedActions)
      .where(
        and(
          inArray(proposedActions.projectId, projectIds),
          eq(proposedActions.status, 'pending'),
          inArray(proposedActions.actionType, TIPOS_DE_ACAO_DE_CONTAINER),
        ),
      );

    // A mais RECENTE (maior `seq`) por projeto, caso mais de uma esteja
    // pendente ao mesmo tempo — não impedido pelo domínio, só raro.
    const acaoPendenteDe = new Map<
      string,
      typeof proposedActions.$inferSelect
    >();
    for (const acao of acoesPendentes) {
      const atual = acaoPendenteDe.get(acao.projectId);
      if (!atual || acao.seq > atual.seq)
        acaoPendenteDe.set(acao.projectId, acao);
    }

    return linhas.map((linha) => {
      const lifecycle = linha.container ? toLifecycle(linha.container) : null;
      const eventos = eventosPorProjeto.get(linha.projectId) ?? [];
      const decisao = lifecycle
        ? decisaoNaVersao(eventos, lifecycle.imageVersion)
        : null;
      const acaoPendente = acaoPendenteDe.get(linha.projectId);
      return {
        projectId: linha.projectId,
        projectName: linha.projectName,
        projectSlug: linha.projectSlug,
        executionMode: linha.executionMode,
        lifecycle,
        imagem: decisao?.image ?? null,
        // QUALQUER evento basta: `ObterContainerDoProjetoUseCase` degrada um
        // payload ilegível para o default em vez de recusá-lo, então "existe
        // evento" e "existe decisão vigente" são a mesma pergunta — e é essa
        // a pergunta do portão da RN-105.
        temImagemDecidida: eventos.length > 0,
        workspaceVerifiedAt: linha.workspaceVerifiedAt,
        acaoPendente: acaoPendente ? toProposedAction(acaoPendente) : null,
      };
    });
  }
}
