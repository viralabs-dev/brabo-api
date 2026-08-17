/**
 * O papel `platform` (`docs/fluxo.yml`, `camada_plataforma`), como SCRIPT.
 *
 * Uso: pnpm --filter api relatorio:telemetria [--projeto <uuid>] [--json]
 *
 * ## Por que script, e por que agora
 *
 * `docs/fluxo.yml` descreve `platform` como "SRE / Platform — dono do loop de
 * retorno", com `status: planned` e `ativacao: sincronizada com
 * DEPLOY_ENABLED`. `DEPLOY_ENABLED` não existe — não há ambiente de produção
 * com tráfego real, não há SLO definido em lugar nenhum do produto e não há
 * postmortem possível sem incidente de verdade. Construir o papel como agente
 * LLM ou GenServer hoje seria inventar autoridade sobre um loop que não
 * fecha: o "dono do loop de retorno" fica em `planned` DE PROPÓSITO.
 *
 * O que já existe, e não é pouco: o `DomainGaugesCollector`
 * (`src/infrastructure/observability/domain-gauges.collector.ts`) já coleta,
 * a cada `METRICS_GAUGE_INTERVAL_MS`, sessões ativas/closing por projeto,
 * tasks bloqueadas por projeto e o estado do último backup — para o scrape do
 * Prometheus. Este script faz as MESMAS perguntas, mas como leitura PONTUAL,
 * sob demanda, para quem está olhando um projeto agora e não quer abrir o
 * Grafana. Ele não é um segundo coletor: não registra gauge nenhum, não roda
 * em `setInterval`, e termina depois de imprimir.
 *
 * As consultas SQL não são importadas do coletor porque os métodos dele
 * (`collectSessions`/`collectBlockedTasks`/`collectBackup`) são privados e
 * terminam escrevendo em `this.metrics.*.set(...)` — não há uma metade pura
 * de "só a query" para reusar sem acoplar este script ao registro
 * Prometheus. As consultas abaixo são as MESMAS (mesmas tabelas, mesmos
 * filtros), replicadas deliberadamente — replicar uma query de leitura é
 * mais barato do que abrir uma dependência entre um script avulso e um
 * `@Injectable` do NestJS que só faz sentido dentro do ciclo de vida do
 * módulo.
 *
 * ## O que este relatório NÃO é
 *
 * Ele diz isso explicitamente na própria saída, na seção "não medido":
 *
 * 1. **SLO numérico formal.** Nenhum está definido em lugar nenhum do
 *    produto — inventar um número aqui seria a mesma classe de erro que o
 *    ADR 0042 já recusa para nota de modelo e o ADR 0077 recusa para
 *    qualidade de código.
 * 2. **Postmortem.** Depende de incidente real; não há um a analisar.
 * 3. **Loop fechado.** Este script é leitura pontual, avulsa, disparada por
 *    quem a pede. Ele não observa, decide e age sozinho — isso é o que
 *    tornaria `platform` um papel `active`, e o gatilho (`DEPLOY_ENABLED`)
 *    continua ausente.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import {
  DRIZZLE,
  type DrizzleDb,
} from '../src/infrastructure/persistence/drizzle/drizzle-client';
import { backupRuns, projects, sessions, stories, tasks } from '../src/db/schema';

export interface Opcoes {
  projeto: string | null;
  json: boolean;
  erro?: string;
}

/**
 * Argumentos puros — sem `process.exit`, para poder ser testado direto.
 * `--projeto` é OPCIONAL: sem ele, o relatório cobre todos os projetos com
 * sessão ativa/closing ou task bloqueada (o mesmo recorte que o coletor de
 * gauges enxerga, que também não é escopado a um projeto só).
 */
export function parseArgs(argv: string[]): Opcoes {
  const args = argv[0] === '--' ? argv.slice(1) : argv;

  if (args.includes('--projeto')) {
    const valor = args[args.indexOf('--projeto') + 1];
    if (!valor || valor.startsWith('--')) {
      return { projeto: null, json: false, erro: '--projeto exige um uuid' };
    }
    return { projeto: valor, json: args.includes('--json') };
  }

  for (const a of args) {
    if (a !== '--json' && a !== '--projeto') {
      return { projeto: null, json: false, erro: `opção desconhecida: ${a}` };
    }
  }

  return { projeto: null, json: args.includes('--json') };
}

/** `2h15m` / `41m` / `12s` — a mesma legibilidade de `medir-execucao.ts`. */
export function formatarIdade(segundos: number): string {
  if (segundos < 0) return 'nunca houve backup';
  if (segundos < 60) return `${Math.round(segundos)}s`;
  const m = Math.floor(segundos / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d${String(h % 24).padStart(2, '0')}h`;
}

export function formatarBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const unidades = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    unidades.length - 1,
  );
  const valor = bytes / 1024 ** i;
  return `${i === 0 ? valor : valor.toFixed(1)} ${unidades[i]}`;
}

interface SessaoPorProjeto {
  projectId: string;
  projeto: string;
  ativas: number;
  closing: number;
}

interface TaskBloqueadaPorProjeto {
  projectId: string;
  projeto: string;
  total: number;
}

interface Backup {
  ultimoSucesso: { finishedAt: Date; sizeBytes: number } | null;
  idadeSegundos: number;
  ultimoStatus: string | null;
}

export interface Snapshot {
  geradoEm: string;
  projetoFiltrado: { id: string; nome: string } | null;
  sessoes: SessaoPorProjeto[];
  tasksBloqueadas: TaskBloqueadaPorProjeto[];
  backup: Backup;
}

async function coletar(db: DrizzleDb, projetoId: string | null): Promise<Snapshot> {
  let projetoFiltrado: { id: string; nome: string } | null = null;
  if (projetoId) {
    const [row] = await db
      .select({ id: projects.id, nome: projects.name })
      .from(projects)
      .where(eq(projects.id, projetoId));
    if (!row) throw new Error(`projeto ${projetoId} não existe`);
    projetoFiltrado = row;
  }

  // --- sessões ativas/closing por projeto -----------------------------------
  // Mesma consulta de `DomainGaugesCollector.collectSessions`: `active` e
  // `closing` são consultadas separadamente porque "ativa" é o gauge por
  // projeto e "closing" é transição — a mesma distinção do coletor.
  const ativasRows = await db
    .select({
      projectId: sessions.projectId,
      nome: projects.name,
      total: sql<number>`count(*)::int`,
    })
    .from(sessions)
    .innerJoin(projects, eq(sessions.projectId, projects.id))
    .where(
      and(
        eq(sessions.status, 'active'),
        projetoId ? eq(sessions.projectId, projetoId) : undefined,
      ),
    )
    .groupBy(sessions.projectId, projects.name);

  const closingRows = await db
    .select({
      projectId: sessions.projectId,
      nome: projects.name,
      total: sql<number>`count(*)::int`,
    })
    .from(sessions)
    .innerJoin(projects, eq(sessions.projectId, projects.id))
    .where(
      and(
        eq(sessions.status, 'closing'),
        projetoId ? eq(sessions.projectId, projetoId) : undefined,
      ),
    )
    .groupBy(sessions.projectId, projects.name);

  const porProjeto = new Map<string, SessaoPorProjeto>();
  for (const r of ativasRows) {
    porProjeto.set(r.projectId, {
      projectId: r.projectId,
      projeto: r.nome,
      ativas: r.total,
      closing: 0,
    });
  }
  for (const r of closingRows) {
    const atual = porProjeto.get(r.projectId);
    if (atual) atual.closing = r.total;
    else
      porProjeto.set(r.projectId, {
        projectId: r.projectId,
        projeto: r.nome,
        ativas: 0,
        closing: r.total,
      });
  }

  // --- tasks bloqueadas por projeto ------------------------------------------
  // Mesmo caminho de `collectBlockedTasks`: `tasks` não tem project_id, o
  // vínculo é `tasks.storyId -> stories.projectId`, e "blocked" é a coluna
  // booleana — task bloqueada volta para `todo` com `blocked = true`.
  const bloqueadasRows = await db
    .select({
      projectId: stories.projectId,
      nome: projects.name,
      total: sql<number>`count(*)::int`,
    })
    .from(tasks)
    .innerJoin(stories, eq(tasks.storyId, stories.id))
    .innerJoin(projects, eq(stories.projectId, projects.id))
    .where(
      and(
        eq(tasks.blocked, true),
        isNotNull(stories.projectId),
        projetoId ? eq(stories.projectId, projetoId) : undefined,
      ),
    )
    .groupBy(stories.projectId, projects.name);

  // --- backup — GLOBAL, nunca por projeto -----------------------------------
  // O produto tem um backup só, do banco inteiro (`backup_runs`, sem
  // `project_id`): `--projeto` não filtra esta seção, do mesmo jeito que
  // `DomainGaugesCollector.collectBackup` não recebe projeto nenhum.
  const [sucesso] = await db
    .select({ finishedAt: backupRuns.finishedAt, sizeBytes: backupRuns.sizeBytes })
    .from(backupRuns)
    .where(eq(backupRuns.status, 'ok'))
    .orderBy(desc(backupRuns.finishedAt))
    .limit(1);

  const [ultima] = await db
    .select({ status: backupRuns.status })
    .from(backupRuns)
    .orderBy(desc(backupRuns.finishedAt))
    .limit(1);

  return {
    geradoEm: new Date().toISOString(),
    projetoFiltrado,
    sessoes: [...porProjeto.values()],
    tasksBloqueadas: bloqueadasRows.map((r) => ({
      projectId: r.projectId,
      projeto: r.nome,
      total: r.total,
    })),
    backup: {
      ultimoSucesso: sucesso ?? null,
      // -1: "nunca houve backup" — mesma convenção do coletor, para não
      // confundir com "backup de 1970".
      idadeSegundos: sucesso
        ? Math.max(0, Date.now() / 1000 - sucesso.finishedAt.getTime() / 1000)
        : -1,
      ultimoStatus: ultima?.status ?? null,
    },
  };
}

function imprimir(s: Snapshot): void {
  console.log('# Relatório de telemetria — snapshot sob demanda\n');
  console.log(`- gerado em: ${s.geradoEm}`);
  console.log(
    s.projetoFiltrado
      ? `- projeto: ${s.projetoFiltrado.nome} (\`${s.projetoFiltrado.id}\`)`
      : '- projeto: todos (nenhum \`--projeto\` informado)',
  );

  console.log('\n## Sessões ativas/closing por projeto\n');
  if (s.sessoes.length === 0) {
    console.log('_nenhuma sessão ativa ou em fechamento agora._');
  } else {
    console.log('| projeto | ativas | closing |');
    console.log('|---|---|---|');
    for (const p of s.sessoes) {
      console.log(`| ${p.projeto} | ${p.ativas} | ${p.closing} |`);
    }
  }

  console.log('\n## Tasks bloqueadas por projeto\n');
  if (s.tasksBloqueadas.length === 0) {
    console.log('_nenhuma task bloqueada agora._');
  } else {
    console.log('| projeto | bloqueadas |');
    console.log('|---|---|');
    for (const t of s.tasksBloqueadas) {
      console.log(`| ${t.projeto} | ${t.total} |`);
    }
  }

  console.log('\n## Backup (global — não filtra por projeto)\n');
  if (s.backup.ultimoSucesso) {
    console.log(
      `- último sucesso: ${s.backup.ultimoSucesso.finishedAt.toISOString()} (idade: ${formatarIdade(s.backup.idadeSegundos)})`,
    );
    console.log(`- tamanho: ${formatarBytes(s.backup.ultimoSucesso.sizeBytes)}`);
  } else {
    console.log('- último sucesso: **nunca houve backup**');
  }
  console.log(
    `- status da última execução (sucesso ou falha): ${s.backup.ultimoStatus ?? '— nenhuma execução registrada —'}`,
  );

  console.log('\n## Onde ver mais\n');
  console.log(
    '- Dashboards versionados: `deploy/k8s/observability/dashboards/brabo-executivo.json`, ' +
      '`brabo-operacional.json`, `brabo-logs.json`',
  );
  console.log(
    '- Alertas configurados: `deploy/k8s/observability/alerts/brabo-alerts.yaml`',
  );
  console.log('- Runbook operacional: `docs/runbook.md#observabilidade`');
  console.log(
    '- Observabilidade local (Prometheus + Loki + Alloy + Grafana, opt-in): `pnpm dev:obs`',
  );
  console.log(
    '- Como se segue uma ação pelo sistema (trace/log/correlação): ' +
      '`docs/explanation/observability.md`',
  );

  console.log('\n## Não medido\n');
  console.log(
    '- **SLO numérico formal** — nenhum está definido no produto hoje; este ' +
      'relatório não inventa um número.',
  );
  console.log(
    '- **Postmortem** — depende de incidente real; não há um a analisar.',
  );
  console.log(
    '- **Telemetria de volta ao produto, em loop fechado** — hoje é só ' +
      'leitura pontual sob demanda (este script). Observar, decidir e agir ' +
      'sozinho é o que tornaria `platform` `active` em `docs/fluxo.yml`, e o ' +
      'gatilho (`DEPLOY_ENABLED`) ainda não existe.',
  );
}

async function main() {
  const opcoes = parseArgs(process.argv.slice(2));
  if (opcoes.erro) {
    console.error(
      `uso: relatorio-telemetria.ts [--projeto <uuid>] [--json]\n${opcoes.erro}`,
    );
    process.exit(2);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const db = app.get<DrizzleDb>(DRIZZLE);

  let snapshot: Snapshot;
  try {
    snapshot = await coletar(db, opcoes.projeto);
  } catch (error) {
    console.error((error as Error).message);
    await app.close();
    process.exit(2);
  }

  if (opcoes.json) {
    console.log(JSON.stringify(snapshot, null, 2));
  } else {
    imprimir(snapshot);
  }

  await app.close();
}

// Só roda como CLI — importar o módulo no teste não pode subir o Nest nem
// chamar `process.exit` (mesma guarda de `medir-execucao.ts`).
if (process.argv[1]?.endsWith('relatorio-telemetria.ts')) void main();
