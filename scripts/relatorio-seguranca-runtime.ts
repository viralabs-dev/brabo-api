/**
 * Relatório do papel `secops-runtime` (docs/fluxo.yml, camada_seguranca).
 *
 * Uso: pnpm --filter api relatorio:seguranca-runtime [--top N] [--json]
 *
 * ## Por que um SCRIPT, e não um agente ou detector automático
 *
 * `secops-runtime` nasceu `proposto` em docs/fluxo.yml com o critério de
 * separação "produção com tráfego real (pós DEPLOY_ENABLED + platform
 * ativo)". Esse gatilho não disparou — não há tráfego de produção. O que
 * existe hoje é `rate_limit_hits` (RateLimitGuard, ADR 0027): uma linha por
 * request contado, gravada mesmo sob tráfego de dev/CI.
 *
 * Este script lê esse dado real e produz um relatório sobre PADRÃO de abuso
 * — ranking de baldes, distribuição temporal. Ele NÃO detecta incidente
 * (não há threshold nem alarme), NÃO responde a nada, e NÃO produz
 * postmortem: as três dependem do gatilho que ainda não veio, e fingir que
 * dependem é o erro que os ADRs 0041/0042/0077 já recusam para outras
 * lacunas — inventar capacidade que o produto não tem.
 *
 * ## A janela é curta, e o relatório diz isso
 *
 * `DomainGaugesCollector.pruneRateLimit` apaga hits mais velhos que
 * `2 × RATE_LIMIT_WINDOW_MS` (240s por padrão, com o default de
 * `RATE_LIMIT_WINDOW_MS=60000`), a cada `METRICS_GAUGE_INTERVAL_MS` (15s por
 * padrão). A tabela nunca guarda mais que uns poucos minutos de histórico —
 * o script declara a janela teórica E a janela que os dados efetivamente
 * cobrem, para nunca insinuar um histórico maior do que o que existe.
 *
 * ## O que `bucket_key` carrega, e o que ele NÃO carrega
 *
 * `RateLimitGuard.registrarEContar` grava só `bucket_key` (`user:<uuid>` ou
 * `ip:<endereço>`) e `occurred_at`. NÃO há rota, método nem motivo — quem
 * pensava em "ranking de IP por rota" está pedindo um dado que a tabela não
 * guarda. O relatório trabalha com o que existe: balde (usuário ou IP) e
 * quando.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { asc } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import {
  DRIZZLE,
  type DrizzleDb,
} from '../src/infrastructure/persistence/drizzle/drizzle-client';
import { rateLimitHits } from '../src/db/schema';

interface Opcoes {
  top: number;
  json: boolean;
}

function lerOpcoes(): Opcoes {
  const args = process.argv.slice(2);
  const topIdx = args.indexOf('--top');
  const top = topIdx === -1 ? 15 : Number(args[topIdx + 1]);
  return {
    top: Number.isFinite(top) && top > 0 ? top : 15,
    json: args.includes('--json'),
  };
}

export interface HitBruto {
  bucketKey: string;
  occurredAt: Date;
}

export type TipoDeBalde = 'usuario' | 'ip' | 'desconhecido';

/**
 * `bucket_key` é `user:<uuid>` ou `ip:<endereço>` — RateLimitGuard nunca
 * grava outro formato. Um prefixo diferente é tratado como `desconhecido`
 * em vez de estourar: o relatório não deve morrer por um dado que uma
 * versão futura do guard viesse a gravar diferente.
 */
export function interpretarBalde(bucketKey: string): {
  tipo: TipoDeBalde;
  identificador: string;
} {
  if (bucketKey.startsWith('user:')) {
    return { tipo: 'usuario', identificador: bucketKey.slice('user:'.length) };
  }
  if (bucketKey.startsWith('ip:')) {
    return { tipo: 'ip', identificador: bucketKey.slice('ip:'.length) };
  }
  return { tipo: 'desconhecido', identificador: bucketKey };
}

export interface LinhaDoRanking {
  bucketKey: string;
  tipo: TipoDeBalde;
  identificador: string;
  hits: number;
  primeiro: Date;
  ultimo: Date;
}

/**
 * Ranking de baldes por volume de hits, decrescente. Empate desempata pelo
 * hit mais RECENTE (quem está batendo agora importa mais que quem bateu e
 * parou).
 */
export function rankingDeBaldes(hits: readonly HitBruto[]): LinhaDoRanking[] {
  const porBalde = new Map<string, HitBruto[]>();
  for (const hit of hits) {
    const lista = porBalde.get(hit.bucketKey);
    if (lista) lista.push(hit);
    else porBalde.set(hit.bucketKey, [hit]);
  }

  const linhas: LinhaDoRanking[] = [];
  for (const [bucketKey, doBalde] of porBalde) {
    const { tipo, identificador } = interpretarBalde(bucketKey);
    const tempos = doBalde.map((h) => h.occurredAt.getTime());
    linhas.push({
      bucketKey,
      tipo,
      identificador,
      hits: doBalde.length,
      primeiro: new Date(Math.min(...tempos)),
      ultimo: new Date(Math.max(...tempos)),
    });
  }

  return linhas.sort(
    (a, b) => b.hits - a.hits || b.ultimo.getTime() - a.ultimo.getTime(),
  );
}

export interface FatiaTemporal {
  inicio: Date;
  fim: Date;
  hits: number;
}

/**
 * Distribui os hits em fatias de tamanho fixo, do primeiro ao último hit —
 * é o "padrão temporal" (picos de tentativa). Fatia SEM hit entra com zero:
 * omitir fatias vazias esconderia justamente o formato do pico (rajada
 * seguida de silêncio olha diferente de tráfego constante).
 *
 * Com um hit só (ou nenhum), não há intervalo a fatiar — devolve lista
 * vazia em vez de uma fatia degenerada de duração zero.
 */
export function padraoTemporal(
  hits: readonly HitBruto[],
  tamanhoFatiaMs: number,
): FatiaTemporal[] {
  if (hits.length === 0) return [];

  const tempos = hits.map((h) => h.occurredAt.getTime());
  const inicio = Math.min(...tempos);
  const fim = Math.max(...tempos);
  if (fim === inicio) return [];

  const numFatias = Math.max(1, Math.ceil((fim - inicio + 1) / tamanhoFatiaMs));
  const contagem = new Array<number>(numFatias).fill(0);

  for (const t of tempos) {
    const idx = Math.min(
      numFatias - 1,
      Math.floor((t - inicio) / tamanhoFatiaMs),
    );
    contagem[idx] += 1;
  }

  return contagem.map((c, i) => ({
    inicio: new Date(inicio + i * tamanhoFatiaMs),
    fim: new Date(Math.min(fim, inicio + (i + 1) * tamanhoFatiaMs - 1)),
    hits: c,
  }));
}

/** `2min` / `45s` — igual em espírito ao `formatarDuracao` de medir-execucao.ts. */
export function formatarDuracao(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}min${String(s % 60).padStart(2, '0')}s`;
}

export interface RelatorioSegurancaRuntime {
  geradoEm: string;
  janelaConfiguravel: {
    rateLimitWindowMs: number;
    retencaoTeoricaMs: number;
    retencaoTeorica: string;
  };
  janelaObservada: {
    totalHits: number;
    primeiro: string | null;
    ultimo: string | null;
    cobertura: string | null;
  };
  ranking: {
    bucketKey: string;
    tipo: TipoDeBalde;
    identificador: string;
    hits: number;
    primeiro: string;
    ultimo: string;
  }[];
  padraoTemporal: { inicio: string; fim: string; hits: number }[];
  naoMedido: string[];
}

const NAO_MEDIDO = [
  'detecção automática de incidente — exigiria threshold/alarme sobre ' +
    'tráfego contínuo de produção, que não existe (só tráfego de dev/CI ' +
    'gerou os hits abaixo)',
  'resposta a incidente — não há incidente real para responder; ' +
    'depende do mesmo gatilho (produção com tráfego real, pós ' +
    'DEPLOY_ENABLED + platform ativo)',
  'postmortem de segurança — não há incidente para investigar; mesma ' +
    'dependência',
];

/** Monta o relatório a partir dos hits já lidos do banco. Função pura, testável. */
export function montarRelatorio(
  hits: readonly HitBruto[],
  opts: { top: number; rateLimitWindowMs: number; tamanhoFatiaMs: number },
): RelatorioSegurancaRuntime {
  const retencaoTeoricaMs = opts.rateLimitWindowMs * 2;
  const ranking = rankingDeBaldes(hits).slice(0, opts.top);
  const fatias = padraoTemporal(hits, opts.tamanhoFatiaMs);

  const tempos = hits.map((h) => h.occurredAt.getTime());
  const primeiro = hits.length > 0 ? new Date(Math.min(...tempos)) : null;
  const ultimo = hits.length > 0 ? new Date(Math.max(...tempos)) : null;

  return {
    geradoEm: new Date().toISOString(),
    janelaConfiguravel: {
      rateLimitWindowMs: opts.rateLimitWindowMs,
      retencaoTeoricaMs,
      retencaoTeorica: formatarDuracao(retencaoTeoricaMs),
    },
    janelaObservada: {
      totalHits: hits.length,
      primeiro: primeiro?.toISOString() ?? null,
      ultimo: ultimo?.toISOString() ?? null,
      cobertura:
        primeiro && ultimo
          ? formatarDuracao(ultimo.getTime() - primeiro.getTime())
          : null,
    },
    ranking: ranking.map((r) => ({
      ...r,
      primeiro: r.primeiro.toISOString(),
      ultimo: r.ultimo.toISOString(),
    })),
    padraoTemporal: fatias.map((f) => ({
      inicio: f.inicio.toISOString(),
      fim: f.fim.toISOString(),
      hits: f.hits,
    })),
    naoMedido: NAO_MEDIDO,
  };
}

function imprimir(r: RelatorioSegurancaRuntime): void {
  console.log('# Relatório de segurança de runtime — rate_limit_hits\n');
  console.log(`- gerado em: ${r.geradoEm}`);
  console.log(
    `- janela de retenção CONFIGURADA: ${r.janelaConfiguravel.retencaoTeorica} ` +
      `(2 × RATE_LIMIT_WINDOW_MS=${r.janelaConfiguravel.rateLimitWindowMs}ms, ` +
      `apagada por \`DomainGaugesCollector.pruneRateLimit\`)`,
  );
  if (r.janelaObservada.totalHits === 0) {
    console.log(
      '- **sem dado**: `rate_limit_hits` está vazia agora. Isto é normal ' +
        'sob tráfego baixo — a poda apaga tudo fora da janela acima — e não ' +
        'significa ausência de abuso fora dela.\n',
    );
  } else {
    console.log(
      `- janela OBSERVADA: ${r.janelaObservada.primeiro} → ` +
        `${r.janelaObservada.ultimo} (cobre ${r.janelaObservada.cobertura}, ` +
        `${r.janelaObservada.totalHits} hit(s)) — nunca maior que a janela ` +
        'configurada acima; se igual a ela, é sinal de que hits mais antigos ' +
        'já foram podados, não de que não existiram\n',
    );
  }

  console.log('## Ranking de baldes (usuário/IP) com mais hits\n');
  if (r.ranking.length === 0) {
    console.log('_nenhum hit na janela retida._\n');
  } else {
    console.log('| tipo | identificador | hits | primeiro | último |');
    console.log('|---|---|---|---|---|');
    for (const linha of r.ranking) {
      console.log(
        `| ${linha.tipo} | ${linha.identificador} | ${linha.hits} | ` +
          `${linha.primeiro} | ${linha.ultimo} |`,
      );
    }
    console.log('');
  }

  console.log('## Padrão temporal (picos de tentativa)\n');
  if (r.padraoTemporal.length === 0) {
    console.log(
      '_menos de dois instantes distintos — sem intervalo a fatiar._\n',
    );
  } else {
    console.log('| fatia | hits |');
    console.log('|---|---|');
    for (const fatia of r.padraoTemporal) {
      console.log(`| ${fatia.inicio} → ${fatia.fim} | ${fatia.hits} |`);
    }
    console.log('');
  }

  console.log('## Não medido (fora do escopo deste script)\n');
  console.log(
    'O gatilho de `secops-runtime` em docs/fluxo.yml — produção com ' +
      'tráfego real, pós `DEPLOY_ENABLED` + platform ativo — não disparou. ' +
      'O que segue depende dele e NÃO está neste relatório:\n',
  );
  for (const item of r.naoMedido) {
    console.log(`- ${item}`);
  }
}

async function main() {
  const { top, json } = lerOpcoes();
  const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
  // Fatia de 10s: fina o bastante para separar rajada de tráfego constante
  // dentro de uma janela retida de poucos minutos, sem virar uma linha por
  // hit.
  const tamanhoFatiaMs = 10_000;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const db = app.get<DrizzleDb>(DRIZZLE);

  const linhas = await db
    .select({
      bucketKey: rateLimitHits.bucketKey,
      occurredAt: rateLimitHits.occurredAt,
    })
    .from(rateLimitHits)
    .orderBy(asc(rateLimitHits.occurredAt));

  await app.close();

  const relatorio = montarRelatorio(linhas, {
    top,
    rateLimitWindowMs,
    tamanhoFatiaMs,
  });

  if (json) {
    console.log(JSON.stringify(relatorio, null, 2));
  } else {
    imprimir(relatorio);
  }
}

// Só roda como CLI — mesma guarda de medir-execucao.ts, para o teste poder
// importar as funções puras sem subir o Nest.
if (process.argv[1]?.endsWith('relatorio-seguranca-runtime.ts')) void main();
