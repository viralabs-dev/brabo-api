/**
 * dbre — relatório de backup/restore (docs/fluxo.yml, papel `dbre`,
 * entregável `backup-restore-testado`).
 *
 * Uso: `pnpm --filter api relatorio:backup [--json]`
 *
 * ## Não é gauge, é leitura pontual
 *
 * `DomainGaugesCollector.collectBackup()`
 * (`src/infrastructure/observability/domain-gauges.collector.ts`) já publica
 * `brabo_backup_*` num timer, para o Grafana/Prometheus. Este script lê a
 * MESMA tabela (`backup_runs`) com a MESMA lógica — último SUCESSO (idade,
 * tamanho) e como terminou a ÚLTIMA execução (para pegar o caso de estar
 * falhando há dias com um backup bom mais antigo) — mas SOB DEMANDA, para
 * quem quer a resposta agora sem abrir um dashboard. Não inventa uma segunda
 * forma de calcular o que o collector já calcula (regra do CLAUDE.md).
 *
 * O limiar de "atrasado" (26h = 93600s) é o MESMO do alerta
 * `brabo-backup-atrasado` (`deploy/k8s/observability/alerts/brabo-alerts.yaml`)
 * — cadência diária às 03:17 UTC mais margem. Duplicado aqui porque o YAML do
 * Grafana não é importável de dentro do processo Node; diverge só se alguém
 * mudar um lado e esquecer o outro.
 *
 * ## O restore em si já foi testado — este script não reexecuta
 *
 * O procedimento de restaurar (`make test-restore` /
 * `deploy/k8s/test-restore.sh`) está documentado e foi EXECUTADO de verdade
 * em `docs/runbook.md#restore` — RTO real ~40s contra um banco de ~108 KB,
 * registrado na seção "Última execução verificada" daquele documento. Este
 * relatório responde uma pergunta mais estreita e mais frequente: "o backup
 * que esse restore usaria está saudável, agora?" — e aponta para o runbook
 * para quem precisa de fato restaurar.
 *
 * ## Desenho
 *
 * `avaliarBackup` é PURA (recebe o que as duas queries devolveriam + o
 * instante atual, devolve a avaliação) — mesmo desenho de
 * `scripts/medir-execucao.ts`/`scripts/lint-migracao.ts`: testável com
 * `backup_runs` mockado, sem banco. `main`/`principal` são o adaptador de
 * I/O: sobem o Nest só para ler `DRIZZLE`, formatam e decidem o código de
 * saída.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { desc, eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import {
  DRIZZLE,
  type DrizzleDb,
} from '../src/infrastructure/persistence/drizzle/drizzle-client';
import { backupRuns } from '../src/db/schema';

/** Mesmo limiar do alerta `brabo-backup-atrasado` — ver cabeçalho do arquivo. */
export const BACKUP_AGE_ATRASADO_SEGUNDOS = 26 * 60 * 60;

export interface UltimoSucesso {
  finishedAt: Date;
  sizeBytes: number;
}

export interface UltimaExecucao {
  status: string;
}

export type StatusDoBackup =
  | 'ok'
  | 'atrasado'
  | 'nunca_houve'
  | 'falha_recente_com_sucesso_antigo';

export interface AvaliacaoDeBackup {
  status: StatusDoBackup;
  /** `null` só quando nunca houve backup bem-sucedido. */
  idadeSegundos: number | null;
  resumo: string;
}

/**
 * Lógica PURA. `agoraMs` entra como parâmetro (nunca `Date.now()` interno)
 * para o teste controlar o relógio sem mockar módulo nenhum.
 */
export function avaliarBackup(
  ultimoSucesso: UltimoSucesso | null,
  ultimaExecucao: UltimaExecucao | null,
  agoraMs: number,
): AvaliacaoDeBackup {
  const falhouSemSucessoRecente =
    ultimaExecucao != null && ultimaExecucao.status !== 'ok';

  if (!ultimoSucesso) {
    return {
      status: 'nunca_houve',
      idadeSegundos: null,
      resumo: falhouSemSucessoRecente
        ? 'nenhum backup bem-sucedido registrado ainda, e a última execução falhou'
        : 'nenhum backup registrado ainda',
    };
  }

  const idadeSegundos = Math.max(
    0,
    (agoraMs - ultimoSucesso.finishedAt.getTime()) / 1000,
  );

  if (idadeSegundos > BACKUP_AGE_ATRASADO_SEGUNDOS) {
    return {
      status: 'atrasado',
      idadeSegundos,
      resumo: `último sucesso há ${formatarIdade(idadeSegundos)} — acima do limiar de 26h`,
    };
  }

  if (falhouSemSucessoRecente) {
    return {
      status: 'falha_recente_com_sucesso_antigo',
      idadeSegundos,
      resumo: `há um backup bom de ${formatarIdade(idadeSegundos)}, mas a ÚLTIMA execução falhou`,
    };
  }

  return {
    status: 'ok',
    idadeSegundos,
    resumo: `último sucesso há ${formatarIdade(idadeSegundos)}, dentro do limiar`,
  };
}

/** `2h15min` / `3d4h` — sem dependência nova, no mesmo espírito de
 * `formatarDuracao` de `scripts/medir-execucao.ts`, mas em escala de dias. */
export function formatarIdade(segundos: number): string {
  const min = Math.round(segundos / 60);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${String(min % 60).padStart(2, '0')}min`;
  const d = Math.floor(h / 24);
  return `${d}d${String(h % 24).padStart(2, '0')}h`;
}

interface HistoricoRun {
  finishedAt: Date;
  kind: string;
  status: string;
  objectKey: string | null;
  sizeBytes: number;
  errorMessage: string | null;
}

export interface RelatorioDeBackup {
  avaliacao: AvaliacaoDeBackup;
  ultimoSucesso: UltimoSucesso | null;
  historico: HistoricoRun[];
}

function formatarBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const unidades = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(
    unidades.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${unidades[i]}`;
}

function imprimir(r: RelatorioDeBackup): void {
  const selo =
    r.avaliacao.status === 'ok'
      ? 'OK'
      : r.avaliacao.status === 'nunca_houve'
        ? 'NUNCA HOUVE'
        : r.avaliacao.status === 'atrasado'
          ? 'ATRASADO'
          : 'FALHA RECENTE';

  console.log(`[relatorio-backup] status: ${selo}`);
  console.log(`  ${r.avaliacao.resumo}`);
  if (r.ultimoSucesso) {
    console.log(
      `  último sucesso: ${r.ultimoSucesso.finishedAt.toISOString()} (${formatarBytes(r.ultimoSucesso.sizeBytes)})`,
    );
  }

  console.log('\nÚltimas execuções (backup_runs):\n');
  console.log('| terminou em | tipo | status | tamanho | erro |');
  console.log('|---|---|---|---|---|');
  if (r.historico.length === 0) {
    console.log('| _(nenhuma linha em `backup_runs`)_ | | | | |');
  } else {
    for (const h of r.historico) {
      console.log(
        `| ${h.finishedAt.toISOString()} | ${h.kind} | ${h.status} | ${formatarBytes(h.sizeBytes)} | ${h.errorMessage ?? '—'} |`,
      );
    }
  }

  console.log(
    '\nProcedimento de restore, testado e documentado: docs/runbook.md#restore ' +
      '(`make test-restore` / `deploy/k8s/test-restore.sh`, RTO real ~40s — ' +
      'ver "Última execução verificada" naquele documento). Este relatório ' +
      'não reexecuta o restore, só avalia se o backup que ele usaria está bom.',
  );
}

export interface Opcoes {
  json: boolean;
}

/** Puro, mesmo padrão de `scripts/validacao-gates.ts` (`parseArgs`). */
export function lerOpcoes(argv: string[]): Opcoes | { erro: string } {
  for (const arg of argv) {
    if (arg === '--' || arg === '--json') continue;
    return { erro: `opção desconhecida: ${arg}` };
  }
  return { json: argv.includes('--json') };
}

async function principal(): Promise<void> {
  const opcoes = lerOpcoes(process.argv.slice(2));
  if ('erro' in opcoes) {
    console.error(`uso: relatorio-backup.ts [--json]\n${opcoes.erro}`);
    process.exit(2);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const db = app.get<DrizzleDb>(DRIZZLE);

  // Mesmas duas consultas de `DomainGaugesCollector.collectBackup()`: último
  // SUCESSO (o que o alerta de idade usa) e como terminou a ÚLTIMA execução
  // (pega o caso de estar falhando há dias com um backup bom mais antigo).
  const [ultimoSucesso] = await db
    .select({
      finishedAt: backupRuns.finishedAt,
      sizeBytes: backupRuns.sizeBytes,
    })
    .from(backupRuns)
    .where(eq(backupRuns.status, 'ok'))
    .orderBy(desc(backupRuns.finishedAt))
    .limit(1);

  const [ultimaExecucao] = await db
    .select({ status: backupRuns.status })
    .from(backupRuns)
    .orderBy(desc(backupRuns.finishedAt))
    .limit(1);

  const historico = await db
    .select({
      finishedAt: backupRuns.finishedAt,
      kind: backupRuns.kind,
      status: backupRuns.status,
      objectKey: backupRuns.objectKey,
      sizeBytes: backupRuns.sizeBytes,
      errorMessage: backupRuns.errorMessage,
    })
    .from(backupRuns)
    .orderBy(desc(backupRuns.finishedAt))
    .limit(10);

  const relatorio: RelatorioDeBackup = {
    avaliacao: avaliarBackup(
      ultimoSucesso ?? null,
      ultimaExecucao ?? null,
      Date.now(),
    ),
    ultimoSucesso: ultimoSucesso ?? null,
    historico,
  };

  if (opcoes.json) {
    console.log(JSON.stringify(relatorio, null, 2));
  } else {
    imprimir(relatorio);
  }

  await app.close();

  process.exit(relatorio.avaliacao.status === 'ok' ? 0 : 1);
}

// Só roda como CLI — mesma guarda de `scripts/medir-execucao.ts`.
if (process.argv[1]?.endsWith('relatorio-backup.ts')) void principal();
