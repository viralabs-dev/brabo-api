import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  DecisionInboxRepository,
  type FilaLida,
  type HipoteseLida,
  type LeituraDaCaixa,
  type ProjetosPorFila,
  type PromocaoLida,
} from '../../../application/ports/decision-inbox-repository.port';
import {
  moduleMaps,
  projectMembers,
  projects,
  proposedActions,
  psychologistAnalyses,
  psychologistHypotheses,
  stories,
} from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';
import { toEntity as acaoDeLinha } from './proposed-action.repository';

type Status = 'pending' | 'decided';

const total = sql<number>`count(*)::int`;

function somar(linhas: { projectId: string; total: number }[]) {
  const porProjeto: Record<string, number> = {};
  let soma = 0;
  for (const l of linhas) {
    porProjeto[l.projectId] = Number(l.total);
    soma += Number(l.total);
  }
  return { porProjeto, total: soma };
}

/**
 * Read model da Caixa de decisões (AT-928, ADR 0295). Nenhuma consulta roda
 * dentro de laço sobre projetos: `inArray(project_id, ids)` + `GROUP BY`, a
 * técnica do resumo do workspace (RN-090). Cada fila custa duas idas (itens
 * até o teto e totais por projeto), mais agentes, histórias e módulos.
 */
@Injectable()
export class DrizzleDecisionInboxRepository implements DecisionInboxRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  projetosDoWorkspace(workspaceId: string) {
    const db = currentDb(this.rootDb);
    return db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.workspaceId, workspaceId))
      .orderBy(asc(projects.name));
  }

  async papeisDeProjeto(workspaceId: string, userId: string) {
    const db = currentDb(this.rootDb);
    return db
      .select({
        projectId: projectMembers.projectId,
        role: projectMembers.role,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          eq(projectMembers.userId, userId),
        ),
      );
  }

  async ler(input: {
    status: Status;
    desde: Date;
    teto: number;
    projetos: ProjetosPorFila;
  }): Promise<LeituraDaCaixa> {
    const { status, desde, teto, projetos } = input;
    const db = currentDb(this.rootDb);
    const pendente = status === 'pending';

    const acaoCond = (ids: string[], merge: boolean): SQL | undefined =>
      and(
        inArray(proposedActions.projectId, ids),
        merge
          ? eq(proposedActions.actionType, 'git_merge')
          : ne(proposedActions.actionType, 'git_merge'),
        pendente
          ? eq(proposedActions.status, 'pending')
          : and(
              ne(proposedActions.status, 'pending'),
              gte(proposedActions.updatedAt, desde),
            ),
      );
    const acoes = async (ids: string[], merge: boolean) => {
      const where = acaoCond(ids, merge);
      const [rows, grupos] = await Promise.all([
        db
          .select()
          .from(proposedActions)
          .where(where)
          .orderBy(
            pendente
              ? asc(proposedActions.createdAt)
              : desc(proposedActions.updatedAt),
          )
          .limit(teto),
        db
          .select({ projectId: proposedActions.projectId, total })
          .from(proposedActions)
          .where(where)
          .groupBy(proposedActions.projectId),
      ]);
      return { itens: rows.map(acaoDeLinha), ...somar(grupos) };
    };

    const promoCond = and(
      inArray(stories.projectId, projetos.promocoes),
      isNull(stories.archivedAt),
      pendente
        ? eq(stories.proposedReady, true)
        : and(eq(stories.proposedReady, false), gte(stories.returnedAt, desde)),
    );
    const promocoes = async (): Promise<FilaLida<PromocaoLida>> => {
      const [rows, grupos] = await Promise.all([
        db
          .select({
            projectId: stories.projectId,
            storyId: stories.id,
            titulo: stories.title,
            updatedAt: stories.updatedAt,
            returnedAt: stories.returnedAt,
          })
          .from(stories)
          .where(promoCond)
          .orderBy(pendente ? asc(stories.updatedAt) : desc(stories.returnedAt))
          .limit(teto),
        db
          .select({ projectId: stories.projectId, total })
          .from(stories)
          .where(promoCond)
          .groupBy(stories.projectId),
      ]);
      return {
        itens: rows.map((r) => ({
          projectId: r.projectId,
          storyId: r.storyId,
          titulo: r.titulo,
          // shortcut: a promoção pendente não grava data própria; `updated_at` da história.
          desde: pendente ? r.updatedAt : (r.returnedAt ?? r.updatedAt),
          decididaEm: pendente ? null : r.returnedAt,
        })),
        ...somar(grupos),
      };
    };

    const hipCond = and(
      inArray(psychologistHypotheses.projectId, projetos.hipoteses),
      eq(psychologistAnalyses.superseded, false),
      pendente
        ? eq(psychologistHypotheses.status, 'proposed')
        : and(
            ne(psychologistHypotheses.status, 'proposed'),
            gte(psychologistHypotheses.decidedAt, desde),
          ),
    );
    const hipoteses = async (): Promise<FilaLida<HipoteseLida>> => {
      const base = () =>
        db
          .select({
            projectId: psychologistHypotheses.projectId,
            hipoteseId: psychologistHypotheses.id,
            hipotese: psychologistHypotheses.hipotese,
            agenteAlvo: psychologistHypotheses.agenteAlvo,
            createdAt: psychologistHypotheses.createdAt,
            situacao: psychologistHypotheses.status,
            decidedAt: psychologistHypotheses.decidedAt,
          })
          .from(psychologistHypotheses)
          .innerJoin(
            psychologistAnalyses,
            eq(psychologistHypotheses.analysisId, psychologistAnalyses.id),
          );
      const [rows, grupos] = await Promise.all([
        base()
          .where(hipCond)
          .orderBy(
            pendente
              ? asc(psychologistHypotheses.createdAt)
              : desc(psychologistHypotheses.decidedAt),
          )
          .limit(teto),
        db
          .select({ projectId: psychologistHypotheses.projectId, total })
          .from(psychologistHypotheses)
          .innerJoin(
            psychologistAnalyses,
            eq(psychologistHypotheses.analysisId, psychologistAnalyses.id),
          )
          .where(hipCond)
          .groupBy(psychologistHypotheses.projectId),
      ]);
      return {
        itens: rows.map((r) => ({
          projectId: r.projectId,
          hipoteseId: r.hipoteseId,
          hipotese: r.hipotese,
          agenteAlvo: r.agenteAlvo,
          desde: r.createdAt,
          situacao: r.situacao,
          decididaEm: r.decidedAt,
        })),
        ...somar(grupos),
      };
    };

    const agentes = async () => {
      const ids = [...new Set([...projetos.aprovacoes, ...projetos.prs])];
      const rows = await db
        .selectDistinct({
          projectId: proposedActions.projectId,
          actorId: proposedActions.actorId,
        })
        .from(proposedActions)
        .where(
          and(
            inArray(proposedActions.projectId, ids),
            eq(proposedActions.status, 'pending'),
            eq(proposedActions.actorKind, 'agent'),
          ),
        );
      const porProjeto: Record<string, string[]> = {};
      for (const r of rows) (porProjeto[r.projectId] ??= []).push(r.actorId);
      return porProjeto;
    };

    // Arquitetura é derivada (sem data, sem decisão humana): só há o que ler
    // no modo pendente; no decidido as duas leituras vão com lista vazia, que
    // o `inArray` resolve a `false` sem mudar o número de idas ao banco.
    const idsArq = pendente ? projetos.arquitetura : [];

    const [
      aprovacoesLidas,
      prsLidas,
      promocoesLidas,
      hipotesesLidas,
      agentesAguardando,
      historias,
      mapas,
    ] = await Promise.all([
      acoes(projetos.aprovacoes, false),
      acoes(projetos.prs, true),
      promocoes(),
      hipoteses(),
      agentes(),
      db
        .select({
          id: stories.id,
          projectId: stories.projectId,
          title: stories.title,
          status: stories.status,
          moduleIds: stories.moduleIds,
          updatedAt: stories.updatedAt,
        })
        .from(stories)
        .where(
          and(inArray(stories.projectId, idsArq), isNull(stories.archivedAt)),
        )
        .orderBy(asc(stories.updatedAt)),
      db
        .selectDistinctOn([moduleMaps.projectId], {
          projectId: moduleMaps.projectId,
          modules: moduleMaps.modules,
        })
        .from(moduleMaps)
        .where(inArray(moduleMaps.projectId, idsArq))
        .orderBy(moduleMaps.projectId, desc(moduleMaps.version)),
    ]);

    return {
      aprovacoes: aprovacoesLidas,
      prs: prsLidas,
      promocoes: promocoesLidas,
      hipoteses: hipotesesLidas,
      historias,
      modulosPorProjeto: Object.fromEntries(
        mapas.map((m) => [m.projectId, m.modules.map((x) => x.name)]),
      ),
      agentesAguardando,
    };
  }
}
