import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
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
 * Read model da página global de containers (ADR 0136, RN-495) — TRÊS
 * consultas, quantos projetos forem, mesmo espírito de
 * `DrizzleProjectsSummaryRepository`.
 */
@Injectable()
export class DrizzleContainersOverviewRepository implements ContainersOverviewRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async listForWorkspace(workspaceId: string): Promise<ContainerOverviewRow[]> {
    const db = currentDb(this.rootDb);

    // INNER JOIN: só entra quem já tem linha de ciclo de vida — é a régua
    // da tela ("cada projeto que já tem project_containers"), aplicada no
    // próprio SQL em vez de filtrada depois no cliente.
    const linhas = await db
      .select({
        projectId: projects.id,
        projectName: projects.name,
        projectSlug: projects.slug,
        container: projectContainers,
      })
      .from(projectContainers)
      .innerJoin(projects, eq(projects.id, projectContainers.projectId))
      .where(eq(projects.workspaceId, workspaceId));

    if (linhas.length === 0) return [];

    const projectIds = linhas.map((l) => l.projectId);

    // Em lote: os eventos `artifact.project_image` de TODOS os projetos
    // encontrados, para resolver a imagem-texto de cada `imageVersion`
    // congelado (`decisaoNaVersao`, domain/containers/project-container.ts).
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
      const lifecycle = toLifecycle(linha.container);
      const decisao = decisaoNaVersao(
        eventosPorProjeto.get(linha.projectId) ?? [],
        lifecycle.imageVersion,
      );
      const acaoPendente = acaoPendenteDe.get(linha.projectId);
      return {
        projectId: linha.projectId,
        projectName: linha.projectName,
        projectSlug: linha.projectSlug,
        lifecycle,
        imagem: decisao?.image ?? null,
        acaoPendente: acaoPendente ? toProposedAction(acaoPendente) : null,
      };
    });
  }
}
