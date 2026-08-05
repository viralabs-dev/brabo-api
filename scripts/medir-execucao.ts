/**
 * O instrumento de medição de uma execução de agentes (FASE 13b, item 4).
 *
 * Uso: pnpm --filter api medir:execucao -- --projeto <uuid> [--json]
 *
 * ## Por que ele existe
 *
 * A colheita do primeiro dogfooding (Fase 10) deixou a metade QUANTITATIVA
 * como `não medido` — restarts, intervenções, custo — porque a tabela de
 * observação era manual e ninguém a preencheu enquanto executava. A lição
 * virou regra no CLAUDE.md: **métrica de execução de agentes é extraída do
 * event log/token_usage por script, nunca anotada à mão.**
 *
 * Este é o script. Ele não é de uma execução específica: recebe um projeto e
 * mede o que houver ali, para servir a qualquer dogfooding futuro.
 *
 * ## Critérios (é por isso que ele sai != 0)
 *
 * Duas coisas não são relatório, são reprovação:
 *
 * 1. **Restart do engine durante a execução.** A Fase 12b existe para que o
 *    dev agent seja reagendado por evento; restart no meio é a muleta que ela
 *    matou, e mascara o defeito que estaria sendo medido.
 * 2. **Turno mudo** — agente que ativa e não escreve nada. É indistinguível,
 *    para quem olha a tela, de um agente pensando; e some no meio do event log
 *    sem nenhum sinal.
 *
 * O resto é medição: sai na tabela, não reprova.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import {
  DRIZZLE,
  type DrizzleDb,
} from '../src/infrastructure/persistence/drizzle/drizzle-client';
import {
  projects,
  proposedActions,
  sessionEvents,
  sessions,
  tokenUsage,
} from '../src/db/schema';

interface Opcoes {
  projeto: string;
  json: boolean;
}

function lerOpcoes(): Opcoes {
  const args = process.argv.slice(2);
  const projeto = args[args.indexOf('--projeto') + 1];

  if (!args.includes('--projeto') || !projeto || projeto.startsWith('--')) {
    console.error('uso: medir-execucao.ts --projeto <uuid> [--json]');
    process.exit(2);
  }

  return { projeto, json: args.includes('--json') };
}

/** `1h02m` / `3m41s` / `12s` — duração legível sem dependência nova. */
export function formatarDuracao(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

export function formatarUsd(micros: number): string {
  if (micros === 0) return 'US$ 0,00';
  const usd = micros / 1_000_000;
  // Abaixo de um centavo, `US$ 0,00` seria indistinguível de gasto ZERO — e a
  // diferença entre "não gastou" e "gastou pouco" é o que se está medindo.
  if (usd < 0.01) return '< US$ 0,01';
  return `US$ ${usd.toFixed(2).replace('.', ',')}`;
}

/**
 * Sinais de CÓDIGO num texto de agente.
 *
 * Serve a uma pergunta só: o Criativo — que conduz ideação de produto — está
 * escrevendo implementação? Não é análise de linguagem, é um farol: acende
 * para quem lê decidir. Por isso o script imprime o TRECHO junto, e nunca
 * reprova sozinho por causa dele.
 */
export const SINAIS_DE_CODIGO: readonly { nome: string; padrao: RegExp }[] = [
  { nome: 'bloco de código', padrao: /```[a-z]*\n/ },
  {
    nome: 'import/require',
    padrao: /^\s*(import .+ from |const .+ = require\()/m,
  },
  { nome: 'definição de função', padrao: /\b(function |def |func |=> \{)/ },
  {
    nome: 'nome de arquivo',
    padrao: /\b[\w./-]+\.(ts|js|py|go|rb|java|json|yml|yaml)\b/,
  },
  {
    nome: 'comando de shell',
    padrao: /\b(npm |pnpm |yarn |docker |git )(install|run|add|build|commit)\b/,
  },
];

export function sinaisDeCodigo(texto: string): string[] {
  return SINAIS_DE_CODIGO.filter((s) => s.padrao.test(texto)).map(
    (s) => s.nome,
  );
}

interface Evento {
  id: string;
  sessionId: string;
  seq: number;
  type: string;
  actorKind: string;
  actorId: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Slug do agente a que o evento se refere.
 *
 * `agent.activated` é escrito pelo USUÁRIO que ativou (`actorKind: 'user'`,
 * `actorId` = id dele) e traz o agente em `payload.agent`; o que o agente
 * escreve depois vem com `actorKind: 'agent'` e `actorId` = slug. Comparar
 * `actorId` dos dois lados nunca casa — casa slug com slug.
 */
export function agenteDe(evento: Evento): string | null {
  if (evento.type === 'agent.activated') {
    const agente = evento.payload?.agent;
    return typeof agente === 'string' ? agente : null;
  }
  return evento.actorKind === 'agent' ? evento.actorId : null;
}

/**
 * Turnos que ativaram um agente e não produziram resposta.
 *
 * A janela é do `agent.activated` até a PRÓXIMA ativação do MESMO AGENTE (ou o
 * fim da sessão): dentro dela tem que haver `agent.response`, `agent.error` ou
 * um handoff — qualquer desfecho escrito. Nada escrito é o turno mudo.
 *
 * `agent.error` conta como desfecho de propósito: falhar em voz alta não é o
 * defeito que se está caçando.
 */
export function turnosMudos(eventos: Evento[]): Evento[] {
  const desfechos = new Set([
    'agent.response',
    'agent.error',
    'handoff.offered',
    'artifact.product_brief',
    'artifact.module_map',
  ]);

  const mudos: Evento[] = [];

  for (const [i, evento] of eventos.entries()) {
    if (evento.type !== 'agent.activated') continue;
    const agente = agenteDe(evento);
    if (agente == null) continue;

    const posteriores = eventos.slice(i + 1);
    const fim = posteriores.findIndex(
      (e) => e.type === 'agent.activated' && agenteDe(e) === agente,
    );
    const janela = fim === -1 ? posteriores : posteriores.slice(0, fim);

    const falou = janela.some(
      (e) => agenteDe(e) === agente && desfechos.has(e.type),
    );
    if (!falou) mudos.push(evento);
  }

  return mudos;
}

/** Texto que um evento carrega, seja qual for o campo em que o agente o pôs. */
function textoDo(evento: Evento): string {
  const p = evento.payload;
  return [p.content, p.text, p.message, p.summary]
    .filter((v): v is string => typeof v === 'string')
    .join('\n');
}

async function main() {
  const { projeto, json } = lerOpcoes();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const db = app.get<DrizzleDb>(DRIZZLE);

  const [projetoRow] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projeto));

  if (!projetoRow) {
    console.error(`projeto ${projeto} não existe`);
    await app.close();
    process.exit(2);
  }

  const sessoes = await db
    .select()
    .from(sessions)
    .where(eq(sessions.projectId, projeto))
    .orderBy(asc(sessions.createdAt));

  if (sessoes.length === 0) {
    console.error(`projeto ${projetoRow.name} não tem sessão nenhuma`);
    await app.close();
    process.exit(2);
  }

  const ids = sessoes.map((s) => s.id);
  const eventos = (await db
    .select()
    .from(sessionEvents)
    .where(inArray(sessionEvents.sessionId, ids))
    .orderBy(asc(sessionEvents.createdAt), asc(sessionEvents.seq))) as Evento[];

  const inicio = eventos[0]?.createdAt ?? sessoes[0].createdAt;
  const fim = eventos[eventos.length - 1]?.createdAt ?? inicio;

  // --- restart do engine ---------------------------------------------------
  // `engine.oban_peers` guarda o boot do líder do Oban: um `started_at` DEPOIS
  // do início da execução só existe se o engine subiu de novo no meio dela.
  // Não dá para contar quantas vezes — a linha é sobrescrita —, e o script diz
  // isso em vez de inventar um número.
  // `db.execute` no driver node-postgres devolve o resultado do pg
  // (`{ rows }`), não um array — destruturar direto quebra em runtime.
  const peerResult = (await db.execute(
    sql`select node, started_at from engine.oban_peers limit 1`,
  )) as unknown as { rows?: { node: string; started_at: Date }[] };
  const peer = peerResult.rows?.[0];

  const engineSubiuDepois =
    peer != null && new Date(peer.started_at) > new Date(inicio);

  // --- intervenções do usuário ---------------------------------------------
  const decisoes = await db
    .select({
      tipo: proposedActions.actionType,
      status: proposedActions.status,
      total: sql<number>`count(*)::int`,
    })
    .from(proposedActions)
    .where(
      and(
        eq(proposedActions.projectId, projeto),
        isNotNull(proposedActions.decidedBy),
      ),
    )
    .groupBy(proposedActions.actionType, proposedActions.status);

  // --- custo por agente ----------------------------------------------------
  const custos = await db
    .select({
      agente: tokenUsage.actorId,
      chamadas: sql<number>`count(*)::int`,
      entrada: sql<number>`sum(${tokenUsage.inputTokens})::int`,
      saida: sql<number>`sum(${tokenUsage.outputTokens})::int`,
      micros: sql<number>`sum(${tokenUsage.costMicros})::bigint`,
      modelo: sql<string>`max(${tokenUsage.modelName})`,
    })
    .from(tokenUsage)
    .where(
      and(
        inArray(tokenUsage.sessionId, ids),
        // RN-038: sem este filtro, uma mensagem sua no chat entra na conta do
        // agente e o custo por agente vira ficção.
        eq(tokenUsage.actorKind, 'agent'),
      ),
    )
    .groupBy(tokenUsage.actorId)
    .orderBy(sql`sum(${tokenUsage.costMicros}) desc`);

  // --- etapas: ativação → desfecho -----------------------------------------
  const etapas = eventos
    .filter((e) => e.type === 'agent.activated')
    .map((ativacao) => {
      const agente = agenteDe(ativacao);
      const posteriores = eventos.slice(eventos.indexOf(ativacao) + 1);
      const desfecho = posteriores.find(
        (e) =>
          agenteDe(e) === agente &&
          ['agent.response', 'handoff.offered', 'agent.error'].includes(e.type),
      );
      return {
        agente: agente ?? ativacao.actorId,
        eventId: ativacao.id,
        desfecho: desfecho?.type ?? '— nenhum —',
        duracao: desfecho
          ? new Date(desfecho.createdAt).getTime() -
            new Date(ativacao.createdAt).getTime()
          : null,
      };
    });

  // --- voltas de gate ------------------------------------------------------
  const gates = eventos.filter((e) => e.type === 'pr.gate_changed');

  // --- o Criativo em código ------------------------------------------------
  const criativoEmCodigo = eventos
    .filter((e) => e.actorId === 'criativo' && textoDo(e).length > 0)
    .map((e) => ({ evento: e, sinais: sinaisDeCodigo(textoDo(e)) }))
    .filter((x) => x.sinais.length > 0);

  const mudos = turnosMudos(eventos);

  const medida = {
    projeto: { id: projetoRow.id, nome: projetoRow.name },
    janela: {
      inicio: new Date(inicio).toISOString(),
      fim: new Date(fim).toISOString(),
      duracao: formatarDuracao(
        new Date(fim).getTime() - new Date(inicio).getTime(),
      ),
    },
    sessoes: sessoes.length,
    eventos: eventos.length,
    engineSubiuDepois,
    etapas,
    turnosMudos: mudos.map((e) => ({
      agente: agenteDe(e) ?? e.actorId,
      eventId: e.id,
      quando: new Date(e.createdAt).toISOString(),
    })),
    intervencoes: decisoes,
    voltasDeGate: gates.map((e) => ({ eventId: e.id, payload: e.payload })),
    custos,
    criativoEmCodigo: criativoEmCodigo.map((x) => ({
      eventId: x.evento.id,
      sinais: x.sinais,
      trecho: textoDo(x.evento).slice(0, 240),
    })),
  };

  if (json) {
    console.log(JSON.stringify(medida, null, 2));
  } else {
    imprimir(medida);
  }

  await app.close();

  // Os dois critérios. O resto é medição.
  const reprovacoes: string[] = [];
  if (engineSubiuDepois) {
    reprovacoes.push(
      `o engine subiu em ${new Date(peer.started_at).toISOString()}, DEPOIS do início da execução — houve restart no meio`,
    );
  }
  if (mudos.length > 0) {
    reprovacoes.push(
      `${mudos.length} turno(s) mudo(s): agente ativado que não escreveu nada`,
    );
  }

  if (reprovacoes.length > 0) {
    console.error('\n[medir-execucao] critério NÃO fechou:');
    for (const r of reprovacoes) console.error(`  - ${r}`);
    process.exit(1);
  }

  console.log(
    '\n[medir-execucao] critérios fechados: sem restart, sem turno mudo.',
  );
}

interface Medida {
  projeto: { id: string; nome: string };
  janela: { inicio: string; fim: string; duracao: string };
  sessoes: number;
  eventos: number;
  engineSubiuDepois: boolean;
  etapas: {
    agente: string;
    eventId: string;
    desfecho: string;
    duracao: number | null;
  }[];
  turnosMudos: { agente: string; eventId: string; quando: string }[];
  intervencoes: { tipo: string; status: string; total: number }[];
  voltasDeGate: { eventId: string; payload: Record<string, unknown> }[];
  custos: {
    agente: string;
    chamadas: number;
    entrada: number;
    saida: number;
    micros: number;
    modelo: string;
  }[];
  criativoEmCodigo: { eventId: string; sinais: string[]; trecho: string }[];
}

/** Markdown, para a tabela cair no documento de validação sem redigitação. */
function imprimir(m: Medida) {
  console.log(`# Execução medida — ${m.projeto.nome}\n`);
  console.log(`- projeto: \`${m.projeto.id}\``);
  console.log(
    `- janela: ${m.janela.inicio} → ${m.janela.fim} (${m.janela.duracao})`,
  );
  console.log(`- sessões: ${m.sessoes} · eventos: ${m.eventos}`);
  console.log(
    `- restart do engine no meio: **${m.engineSubiuDepois ? 'SIM' : 'não'}**\n`,
  );

  console.log('## Etapas\n');
  console.log('| agente | desfecho | duração | event id |');
  console.log('|---|---|---|---|');
  for (const e of m.etapas) {
    console.log(
      `| ${e.agente} | ${e.desfecho} | ${e.duracao === null ? '—' : formatarDuracao(e.duracao)} | \`${e.eventId}\` |`,
    );
  }

  console.log('\n## Custo por agente\n');
  if (m.custos.length === 0) {
    console.log('_nenhuma chamada de LLM com `actor_kind = agent`._');
  } else {
    console.log('| agente | chamadas | in | out | custo | modelo |');
    console.log('|---|---|---|---|---|---|');
    for (const c of m.custos) {
      console.log(
        `| ${c.agente} | ${c.chamadas} | ${c.entrada} | ${c.saida} | ${formatarUsd(Number(c.micros))} | ${c.modelo} |`,
      );
    }
  }

  console.log('\n## Intervenções suas\n');
  if (m.intervencoes.length === 0) {
    console.log('_nenhuma ação decidida por você._');
  } else {
    console.log('| tipo | status | total |');
    console.log('|---|---|---|');
    for (const d of m.intervencoes) {
      console.log(`| ${d.tipo} | ${d.status} | ${d.total} |`);
    }
  }

  console.log('\n## Voltas de gate\n');
  console.log(
    m.voltasDeGate.length === 0
      ? '_nenhum `pr.gate_changed`._'
      : m.voltasDeGate
          .map((g) => `- \`${g.eventId}\` — ${JSON.stringify(g.payload)}`)
          .join('\n'),
  );

  console.log('\n## Turnos mudos\n');
  console.log(
    m.turnosMudos.length === 0
      ? '_nenhum — todo agente ativado escreveu algo._'
      : m.turnosMudos
          .map((t) => `- **${t.agente}** em ${t.quando} — \`${t.eventId}\``)
          .join('\n'),
  );

  console.log('\n## O Criativo tocou em código?\n');
  console.log(
    m.criativoEmCodigo.length === 0
      ? '_nenhum sinal de código nas mensagens dele._'
      : m.criativoEmCodigo
          .map(
            (c) =>
              `- \`${c.eventId}\` — sinais: ${c.sinais.join(', ')}\n\n  > ${c.trecho.replace(/\n/g, '\n  > ')}`,
          )
          .join('\n\n'),
  );
}

// Só roda como CLI. Sem esta guarda, importar o módulo no teste dispararia a
// medição inteira — subindo o Nest e derrubando o processo no `process.exit`
// do parser de argumentos.
if (process.argv[1]?.endsWith('medir-execucao.ts')) void main();
