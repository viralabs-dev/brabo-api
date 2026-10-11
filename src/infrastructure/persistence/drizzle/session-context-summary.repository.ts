import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  SessionContextSummaryRepository,
  TETO_DE_ARQUIVOS_TOCADOS,
  TETO_DE_ITENS_DO_CONTEXTO,
  type PrDaSessao,
  type ResumoDoContextoDaSessao,
} from '../../../application/ports/session-context-summary-repository.port';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

/**
 * RN-827/828 — contagens da sessão inteira para o painel de contexto.
 * Quatro consultas, nenhuma dentro de laço, todas por `session_id`. Leitura
 * só: nada aqui escreve.
 */
@Injectable()
export class DrizzleSessionContextSummaryRepository extends SessionContextSummaryRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {
    super();
  }

  async resumir(
    projectId: string,
    sessionId: string,
  ): Promise<ResumoDoContextoDaSessao> {
    const db = currentDb(this.rootDb);

    // RN-828: a sessão de execução ligada é a que o plano do Dev Lead
    // aprovado NESTA sessão ativou (`executionResult.sessaoDeExecucao`, de
    // `ExecuteExecutionPlanUseCase`). Só do mesmo projeto.
    const ligadas = await db.execute(sql`
      select distinct execution_result->>'sessaoDeExecucao' as sid
      from proposed_actions
      where session_id = ${sessionId}
        and project_id = ${projectId}
        and action_type = 'propose_execution_plan'
        and status = 'executed'
        and execution_result->>'sessaoDeExecucao' is not null
    `);
    const sessoesLidas = [
      sessionId,
      ...(ligadas.rows as { sid: string }[])
        .map((r) => r.sid)
        .filter((sid) => sid !== sessionId),
    ];
    const listaDeSessoes = sql.join(
      sessoesLidas.map((id) => sql`${id}::uuid`),
      sql`, `,
    );

    const [eventos, prs, arquivos, itens] = await Promise.all([
      db.execute(sql`
        select type, actor_id, count(*)::int as total
        from session_events
        where session_id = ${sessionId}
          and type in (
            'artifact.business_rule', 'artifact.decision_record',
            'backlog.epic_created', 'backlog.story_created',
            'backlog.task_created'
          )
        group by type, actor_id
      `),
      db.execute(sql`
        select actor_id, count(*)::int as total
        from proposed_actions
        where session_id = ${sessionId}
          and action_type in ('pr_open', 'open_adr_pr')
        group by actor_id
      `),
      db.execute(sql`
        select a.id as action_id, f->>'path' as path,
               coalesce((f->>'additions')::int, 0) as additions,
               coalesce((f->>'deletions')::int, 0) as deletions,
               count(*) over ()::int as total
        from proposed_actions a,
             jsonb_array_elements(
               case when jsonb_typeof(a.payload->'files') = 'array'
                    then a.payload->'files' else '[]'::jsonb end
             ) f
        where a.project_id = ${projectId}
          and a.session_id in (${listaDeSessoes})
          and a.action_type in ('git_commit', 'git_push')
          and f->>'path' is not null
        order by a.seq desc, f->>'path'
        limit ${TETO_DE_ARQUIVOS_TOCADOS}
      `),
      // RN-844: os ITENS de regra e decisão, não só o número — com eles a
      // lista do painel não depende da janela de 200 eventos. Teto por tipo.
      db.execute(sql`
        select * from (
          select id, seq, type, actor_id, payload,
                 row_number() over (partition by type order by seq desc) as n
          from session_events
          where session_id = ${sessionId}
            and type in ('artifact.business_rule', 'artifact.decision_record')
        ) t
        where n <= ${TETO_DE_ITENS_DO_CONTEXTO}
        order by seq desc
      `),
    ]);

    let regras = 0;
    let decisoes = 0;
    const porAgente = new Map<string, number>();
    const somar = (actorId: string, n: number) =>
      porAgente.set(actorId, (porAgente.get(actorId) ?? 0) + n);
    for (const r of eventos.rows as {
      type: string;
      actor_id: string;
      total: number;
    }[]) {
      if (r.type === 'artifact.business_rule') regras += r.total;
      else if (r.type === 'artifact.decision_record') decisoes += r.total;
      else somar(r.actor_id, r.total);
    }
    for (const r of prs.rows as { actor_id: string; total: number }[]) {
      somar(r.actor_id, r.total);
    }

    const linhas = arquivos.rows as {
      action_id: string;
      path: string;
      additions: number;
      deletions: number;
      total: number;
    }[];

    const contarOrigens = (v: unknown) => (Array.isArray(v) ? v.length : 0);
    const texto = (v: unknown) =>
      typeof v === 'string' && v.trim().length > 0 ? v : null;
    const linhasDeItens = itens.rows as {
      id: string;
      seq: string | number;
      type: string;
      actor_id: string;
      payload: Record<string, unknown> | null;
    }[];
    const itensDeRegras = linhasDeItens
      .filter((l) => l.type === 'artifact.business_rule')
      .map((l) => ({
        eventId: l.id,
        seq: Number(l.seq),
        actorId: l.actor_id,
        titulo: texto(l.payload?.title),
        descricao: texto(l.payload?.description),
        origens: contarOrigens(l.payload?.origin),
      }));
    const itensDeDecisoes = linhasDeItens
      .filter((l) => l.type === 'artifact.decision_record')
      .map((l) => ({
        eventId: l.id,
        seq: Number(l.seq),
        actorId: l.actor_id,
        escolha: texto(l.payload?.choice),
        contexto: texto(l.payload?.context),
      }));

    return {
      sessoesLidas,
      regras,
      decisoes,
      itensDeRegras,
      itensDeDecisoes,
      artefatosPorAgente: [...porAgente.entries()]
        .map(([actorId, quantos]) => ({ actorId, quantos }))
        .sort(
          (a, b) => b.quantos - a.quantos || a.actorId.localeCompare(b.actorId),
        ),
      arquivosTocados: {
        itens: linhas.map((l) => ({
          actionId: l.action_id,
          path: l.path,
          additions: l.additions,
          deletions: l.deletions,
        })),
        total: linhas[0]?.total ?? 0,
        prsNaoLidas: 0,
      },
    };
  }

  async prsDasSessoes(
    projectId: string,
    sessoes: string[],
    teto: number,
  ): Promise<{ itens: PrDaSessao[]; total: number }> {
    if (sessoes.length === 0) return { itens: [], total: 0 };
    const db = currentDb(this.rootDb);
    const lista = sql.join(
      sessoes.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const r = await db.execute(sql`
      select id, execution_result->>'pullRequestId' as pr,
             count(*) over ()::int as total
      from proposed_actions
      where project_id = ${projectId}
        and session_id in (${lista})
        and action_type in ('pr_open', 'open_adr_pr', 'open_infra_pr')
        and status = 'executed'
        and execution_result->>'pullRequestId' is not null
      order by seq desc
      limit ${teto}
    `);
    const linhas = r.rows as { id: string; pr: string; total: number }[];
    return {
      itens: linhas.map((l) => ({ actionId: l.id, pullRequestId: l.pr })),
      total: linhas[0]?.total ?? 0,
    };
  }
}
