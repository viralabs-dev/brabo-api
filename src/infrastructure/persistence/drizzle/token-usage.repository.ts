import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  TokenUsageRepository,
  type AgentTokenUsage,
  type RecordTokenUsageInput,
  type WorkspaceTokenUsageSummary,
} from '../../../application/ports/token-usage-repository.port';
import type { TokenUsage } from '../../../domain/llm/token-usage.entity';
import type {
  CredentialSpendRow,
  SpendBucket,
  SpendDimension,
  SpendScope,
} from '../../../application/ports/token-usage-repository.port';
import { projects, sessions, tokenUsage } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleTokenUsageRepository implements TokenUsageRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async record(input: RecordTokenUsageInput): Promise<TokenUsage> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(tokenUsage)
      .values({
        sessionId: input.sessionId,
        actorKind: input.actor.kind,
        actorId: input.actor.id,
        provider: input.provider,
        modelId: input.modelId,
        modelName: input.modelName,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        estimated: input.estimated,
        costMicros: input.costMicros,
        inputPricePerMillionMicros: input.inputPricePerMillionMicros,
        outputPricePerMillionMicros: input.outputPricePerMillionMicros,
        latencyMs: input.latencyMs,
        bindingOrigin: input.bindingOrigin,
        upstreamProvider: input.upstreamProvider,
      })
      .returning();

    return {
      id: row.id,
      sessionId: row.sessionId,
      actor: { kind: row.actorKind, id: row.actorId },
      provider: row.provider,
      modelId: row.modelId,
      modelName: row.modelName,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      estimated: row.estimated,
      costMicros: row.costMicros,
      inputPricePerMillionMicros: row.inputPricePerMillionMicros,
      outputPricePerMillionMicros: row.outputPricePerMillionMicros,
      latencyMs: row.latencyMs,
      bindingOrigin: row.bindingOrigin,
      upstreamProvider: row.upstreamProvider,
      createdAt: row.createdAt,
    };
  }

  async sumBySessionAndActorIds(
    sessionId: string,
    actorIds: string[],
  ): Promise<number> {
    if (actorIds.length === 0) return 0;
    const db = currentDb(this.rootDb);
    const [result] = await db
      .select({
        total: sql<string>`coalesce(sum(${tokenUsage.costMicros}), 0)`,
      })
      .from(tokenUsage)
      .where(
        and(
          eq(tokenUsage.sessionId, sessionId),
          inArray(tokenUsage.actorId, actorIds),
        ),
      );
    return Number(result?.total ?? 0);
  }

  async sumBySessionGroupedByActor(
    sessionId: string,
  ): Promise<AgentTokenUsage[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select({
        actorId: tokenUsage.actorId,
        costMicros: sql<string>`coalesce(sum(${tokenUsage.costMicros}), 0)`,
        inputTokens: sql<string>`coalesce(sum(${tokenUsage.inputTokens}), 0)`,
        outputTokens: sql<string>`coalesce(sum(${tokenUsage.outputTokens}), 0)`,
      })
      .from(tokenUsage)
      .where(eq(tokenUsage.sessionId, sessionId))
      .groupBy(tokenUsage.actorId);

    return rows.map((row) => ({
      actorId: row.actorId,
      costMicros: Number(row.costMicros),
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
    }));
  }

  async summarizeForWorkspaceThisMonth(
    workspaceId: string,
  ): Promise<WorkspaceTokenUsageSummary> {
    const db = currentDb(this.rootDb);
    const [result] = await db
      .select({
        agentCount: sql<string>`count(distinct ${tokenUsage.actorId})`,
        spentMicros: sql<string>`coalesce(sum(${tokenUsage.costMicros}), 0)`,
      })
      .from(tokenUsage)
      .innerJoin(sessions, eq(sessions.id, tokenUsage.sessionId))
      .innerJoin(projects, eq(projects.id, sessions.projectId))
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          eq(tokenUsage.actorKind, 'agent'),
          gte(tokenUsage.createdAt, sql`date_trunc('month', now())`),
        ),
      );

    return {
      agentCount: Number(result?.agentCount ?? 0),
      spentMicros: Number(result?.spentMicros ?? 0),
    };
  }

  async sumByProjectGroupedByAgentLast30Days(
    projectId: string,
  ): Promise<AgentTokenUsage[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select({
        actorId: tokenUsage.actorId,
        costMicros: sql<string>`coalesce(sum(${tokenUsage.costMicros}), 0)`,
        inputTokens: sql<string>`coalesce(sum(${tokenUsage.inputTokens}), 0)`,
        outputTokens: sql<string>`coalesce(sum(${tokenUsage.outputTokens}), 0)`,
      })
      .from(tokenUsage)
      // `token_usage` pende da SESSÃO; o projeto vem daqui. Mesmo caminho de
      // `summarizeForWorkspaceThisMonth`, um join mais curto.
      .innerJoin(sessions, eq(sessions.id, tokenUsage.sessionId))
      .where(
        and(
          eq(sessions.projectId, projectId),
          eq(tokenUsage.actorKind, 'agent'),
          gte(tokenUsage.createdAt, sql`now() - interval '30 days'`),
        ),
      )
      .groupBy(tokenUsage.actorId);

    return rows.map((row) => ({
      actorId: row.actorId,
      costMicros: Number(row.costMicros),
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
    }));
  }

  async sumByWorkspaceGroupedByProviderAndMonth(
    workspaceId: string,
    meses: number,
  ): Promise<CredentialSpendRow[]> {
    const db = currentDb(this.rootDb);
    const mes = sql<string>`date_trunc('month', ${tokenUsage.createdAt})`;

    const rows = await db
      .select({
        provider: tokenUsage.provider,
        mes,
        actorKind: tokenUsage.actorKind,
        costMicros: sql<string>`coalesce(sum(${tokenUsage.costMicros}), 0)`,
        inputTokens: sql<string>`coalesce(sum(${tokenUsage.inputTokens}), 0)`,
        outputTokens: sql<string>`coalesce(sum(${tokenUsage.outputTokens}), 0)`,
        chamadas: sql<string>`count(*)`,
      })
      .from(tokenUsage)
      // Dois saltos: `token_usage` pende da sessão, a sessão do projeto, e o
      // projeto do workspace — o mesmo caminho de `summarizeForWorkspace…`.
      .innerJoin(sessions, eq(sessions.id, tokenUsage.sessionId))
      .innerJoin(projects, eq(projects.id, sessions.projectId))
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          // Janela em MESES inteiros, alinhada ao começo do mês: o relatório é
          // de conta a pagar, e conta de provider fecha por mês-calendário.
          gte(
            tokenUsage.createdAt,
            sql`date_trunc('month', now()) - make_interval(months => ${meses - 1})`,
          ),
        ),
      )
      .groupBy(tokenUsage.provider, mes, tokenUsage.actorKind)
      .orderBy(desc(mes), tokenUsage.provider);

    return rows.map((row) => ({
      provider: row.provider,
      mes: new Date(row.mes).toISOString(),
      actorKind: row.actorKind,
      costMicros: Number(row.costMicros),
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
      chamadas: Number(row.chamadas),
    }));
  }

  /**
   * O relatório de gasto, num join só (FASE 22).
   *
   * `token_usage` só tem FK para `sessions` — projeto e workspace saem por
   * join, e os dois saltos são sempre os mesmos das agregações acima. Os joins
   * ficam incondicionais mesmo quando a dimensão não os usa: são `inner join`
   * por FK `not null`, não mudam a cardinalidade, e um caminho único é mais
   * barato de manter do que quatro variações do mesmo `from`.
   */
  async sumGroupedBy(
    dimensao: SpendDimension,
    escopo: SpendScope,
  ): Promise<SpendBucket[]> {
    const db = currentDb(this.rootDb);

    // O dia sai como TEXTO já em UTC. `date_trunc` puro devolveria timestamptz,
    // e renderizar isso a oeste de Greenwich joga o bucket para o dia anterior
    // — o mesmo defeito que o relatório por mês já pagou uma vez.
    const dia = sql<string>`to_char(date_trunc('day', ${tokenUsage.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`;

    const chave = {
      model: sql<string>`${tokenUsage.modelName}`,
      project: sql<string>`${projects.id}::text`,
      actor: sql<string>`${tokenUsage.actorId}`,
      session: sql<string>`${tokenUsage.sessionId}::text`,
      day: dia,
    }[dimensao];

    // Rótulo só existe onde há uma tabela com nome. Sessão não tem — quem
    // decide como uma sessão se chama é o front (`session-label.ts`).
    const rotulo =
      dimensao === 'project'
        ? sql<string | null>`${projects.name}`
        : sql<string | null>`null::text`;

    const actorKind =
      dimensao === 'actor'
        ? sql<string | null>`${tokenUsage.actorKind}::text`
        : sql<string | null>`null::text`;

    const condicoes = [
      gte(
        tokenUsage.createdAt,
        sql`now() - make_interval(days => ${escopo.dias})`,
      ),
    ];
    if (escopo.workspaceId) {
      condicoes.push(eq(projects.workspaceId, escopo.workspaceId));
    }
    if (escopo.projectId) {
      condicoes.push(eq(sessions.projectId, escopo.projectId));
    }
    // A cláusula que separa as duas audiências: com ator, a consulta devolve
    // as linhas DELE e de mais ninguém (RN-101).
    if (escopo.actor) {
      condicoes.push(eq(tokenUsage.actorKind, escopo.actor.kind));
      condicoes.push(eq(tokenUsage.actorId, escopo.actor.id));
    }

    const custo = sql<string>`coalesce(sum(${tokenUsage.costMicros}), 0)`;

    const rows = await db
      .select({
        chave,
        rotulo,
        actorKind,
        costMicros: custo,
        inputTokens: sql<string>`coalesce(sum(${tokenUsage.inputTokens}), 0)`,
        outputTokens: sql<string>`coalesce(sum(${tokenUsage.outputTokens}), 0)`,
        chamadas: sql<string>`count(*)`,
      })
      .from(tokenUsage)
      .innerJoin(sessions, eq(sessions.id, tokenUsage.sessionId))
      .innerJoin(projects, eq(projects.id, sessions.projectId))
      .where(and(...condicoes))
      .groupBy(chave, rotulo, actorKind)
      // Série temporal cresce da esquerda para a direita; ranking desce do
      // maior gasto. São eixos diferentes, e ordenar os dois igual esconderia
      // um dos dois.
      .orderBy(dimensao === 'day' ? sql`1 asc` : desc(custo));

    return rows.map((row) => ({
      chave: String(row.chave),
      rotulo: row.rotulo,
      actorKind: row.actorKind,
      costMicros: Number(row.costMicros),
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
      chamadas: Number(row.chamadas),
    }));
  }
}
