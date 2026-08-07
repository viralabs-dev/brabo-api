/**
 * Mede a passagem dos gates declarados em `docs/gates.yml` (FASE 15a, ADR 0054).
 *
 * Uso: pnpm --filter api validacao:gates [--projeto <uuid>] [--sem-banco]
 *
 * ## Três fases, e a ordem importa
 *
 * 1. **Registro** — carrega e valida. Sem banco, antes do Nest: é o que torna o
 *    script útil em CI sem Postgres.
 * 2. **Localizadores** — para gate com evidência de `teste`/`ci`, confirma que
 *    o alvo existe. Alvo que sumiu reprova, pelo mesmo motivo que o docmap
 *    reprova glob morto: regra que nunca dispara finge cobertura.
 * 3. **Event log** — para gate com evidência de `event_log`, a última passagem,
 *    com event id.
 *
 * ## Por que a fase 3 só reprova com `--projeto`
 *
 * Registro e localizadores são afirmações sobre o REPOSITÓRIO: valem sempre.
 * Evidência no event log é afirmação sobre uma EXECUÇÃO, e só existe se houver
 * uma. Sem `--projeto` a fase 3 é relatório — cobrar passagem num banco recém
 * criado faria o script sair 1 sempre, e um script que reprova sempre vira
 * ruído que ninguém lê.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import {
  DRIZZLE,
  type DrizzleDb,
} from '../src/infrastructure/persistence/drizzle/drizzle-client';
import { sessionEvents, sessions } from '../src/db/schema';
import {
  acharRegistro,
  carregarRegistro,
  CAMINHO_RELATIVO,
} from '../src/infrastructure/gates/gate-registry.loader';
import {
  gatesCobraveis,
  type EvidenciaEventLog,
  type Gate,
} from '../src/domain/gates/gate-registry';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface Opcoes {
  projeto: string | null;
  semBanco: boolean;
}

/** Puro, para ser testável sem processo. */
export function parseArgs(argv: string[]): Opcoes | { erro: string } {
  let projeto: string | null = null;
  let semBanco = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    // `pnpm <script> -- --flag` repassa o `--` literal. É assim que os scripts
    // irmãos são invocados no repo; recusá-lo seria recusar o uso normal.
    if (arg === '--') {
      continue;
    } else if (arg === '--sem-banco') {
      semBanco = true;
    } else if (arg === '--projeto') {
      const valor = argv[i + 1];
      if (!valor || valor.startsWith('--')) {
        return { erro: '--projeto exige um uuid' };
      }
      projeto = valor;
      i += 1;
    } else {
      return { erro: `opção desconhecida: ${arg}` };
    }
  }

  return { projeto, semBanco };
}

/**
 * Traduz o filtro declarado para SQL. O vocabulário é FECHADO de propósito:
 * `presente` vira teste de existência da chave, o resto vira igualdade. Filtro
 * arbitrário no YAML seria injeção de SQL declarativa.
 */
export function condicaoDoFiltro(filtro: Record<string, string> | undefined) {
  const partes = Object.entries(filtro ?? {}).map(([chave, valor]) =>
    valor === 'presente'
      ? sql`${sessionEvents.payload} ? ${chave}`
      : sql`${sessionEvents.payload}->>${chave} = ${valor}`,
  );
  return partes.length > 0 ? and(...partes) : undefined;
}

interface Passagem {
  gate: string;
  eventId: string | null;
  tipo: string | null;
  quando: Date | null;
}

async function ultimaPassagem(
  db: DrizzleDb,
  gate: Gate,
  evidencia: EvidenciaEventLog,
  sessoes: string[] | null,
): Promise<Passagem> {
  const condicoes = [
    inArray(sessionEvents.type, evidencia.event_types),
    condicaoDoFiltro(evidencia.filtro),
    sessoes ? inArray(sessionEvents.sessionId, sessoes) : undefined,
  ].filter((c) => c !== undefined);

  const [linha] = await db
    .select({
      id: sessionEvents.id,
      type: sessionEvents.type,
      createdAt: sessionEvents.createdAt,
    })
    .from(sessionEvents)
    .where(and(...condicoes))
    .orderBy(desc(sessionEvents.createdAt), desc(sessionEvents.seq))
    .limit(1);

  return {
    gate: gate.id,
    eventId: linha?.id ?? null,
    tipo: linha?.type ?? null,
    quando: linha?.createdAt ?? null,
  };
}

async function main() {
  const opcoes = parseArgs(process.argv.slice(2));
  if ('erro' in opcoes) {
    console.error(`${opcoes.erro}`);
    console.error('uso: validacao-gates.ts [--projeto <uuid>] [--sem-banco]');
    process.exit(2);
  }

  // --- fase 1: o registro -------------------------------------------------
  const caminho = acharRegistro(__dirname);
  if (!caminho) {
    console.error(`${CAMINHO_RELATIVO} não encontrado`);
    process.exit(2);
  }
  const raiz = caminho.slice(0, -CAMINHO_RELATIVO.length);

  let registro;
  try {
    registro = carregarRegistro(__dirname);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }

  const cobraveis = gatesCobraveis(registro);
  console.log(
    `# Gates — ${registro.gates.length} declarados, ` +
      `${cobraveis.length} ativos e block\n`,
  );

  const reprovacoes: string[] = [];

  // --- fase 2: localizadores ----------------------------------------------
  console.log('## Localizadores\n');
  console.log('| gate | evidência | alvo | existe |');
  console.log('|---|---|---|---|');

  for (const gate of cobraveis) {
    const evidencia = gate.evidencia;
    if (!evidencia || evidencia.tipo === 'event_log') continue;

    for (const alvo of [evidencia.arquivo, evidencia.workflow].filter(
      (a): a is string => Boolean(a),
    )) {
      const existe = existsSync(join(raiz, alvo));
      console.log(
        `| ${gate.id} | ${evidencia.tipo} | \`${alvo}\` | ${existe ? 'sim' : '**NÃO**'} |`,
      );
      if (!existe) {
        reprovacoes.push(`${gate.id}: o alvo \`${alvo}\` não existe`);
      }
    }
  }

  // --- fase 3: event log --------------------------------------------------
  const doLog = cobraveis.filter((g) => g.evidencia?.tipo === 'event_log');

  if (opcoes.semBanco) {
    console.log(`\n_fase de event log pulada (\`--sem-banco\`)._`);
  } else {
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error'],
    });
    const db = app.get<DrizzleDb>(DRIZZLE);

    let sessoes: string[] | null = null;
    if (opcoes.projeto) {
      const linhas = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.projectId, opcoes.projeto));
      if (linhas.length === 0) {
        console.error(`projeto ${opcoes.projeto} não tem sessão nenhuma`);
        await app.close();
        process.exit(2);
      }
      sessoes = linhas.map((l) => l.id);
    }

    console.log('\n## Última passagem\n');
    console.log('| gate | tipo | event id | quando |');
    console.log('|---|---|---|---|');

    for (const gate of doLog) {
      const p = await ultimaPassagem(
        db,
        gate,
        gate.evidencia as EvidenciaEventLog,
        sessoes,
      );
      console.log(
        `| ${p.gate} | ${p.tipo ?? '—'} | ${p.eventId ? `\`${p.eventId}\`` : '—'} | ` +
          `${p.quando ? new Date(p.quando).toISOString() : '— nenhuma —'} |`,
      );

      // Só cobra quando você apontou para uma execução: ver o cabeçalho.
      if (!p.eventId && opcoes.projeto) {
        reprovacoes.push(
          `${gate.id}: nenhuma passagem no projeto ${opcoes.projeto}`,
        );
      }
    }

    await app.close();
  }

  if (reprovacoes.length > 0) {
    console.error('\n[validacao-gates] critério NÃO fechou:');
    for (const r of reprovacoes) console.error(`  - ${r}`);
    process.exit(1);
  }

  console.log('\n[validacao-gates] registro válido e localizadores no lugar.');
}

// Guarda de entrypoint: os helpers acima são puros e importados pelo teste.
if (process.argv[1]?.endsWith('validacao-gates.ts')) void main();
