import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import * as schema from '../db/schema';
import { projects, sessionEvents, sessions } from '../db/schema';
import { GraphStore } from '../infrastructure/graph/graph-store';
import { GraphUnavailableError } from '../domain/graph/graph-errors';
import {
  EVENTOS_DO_LOG_PROJETAVEIS,
  FECHAMENTOS_DE_SESSAO,
  GraphEventTranslator,
} from '../application/graph-projection/graph-event-translator';
import {
  DrizzleSessionEventRepository,
  toEntity,
} from '../infrastructure/persistence/drizzle/session-event.repository';
import { RecordHandoffUseCase } from '../application/use-cases/graph/record-handoff.use-case';
import { RecordHypothesisUseCase } from '../application/use-cases/graph/record-hypothesis.use-case';
import { RecordAnamneseProfileUseCase } from '../application/use-cases/graph/record-anamnese-profile.use-case';
import { RecordInteractionUseCase } from '../application/use-cases/graph/record-interaction.use-case';

/**
 * Reconstrói o grafo de conhecimento (Neo4j) a partir do event log — o
 * BRB-018, e a RN-569. Ver docs/runbook.md, seção "Losing the graph".
 *
 * O ADR 0152 (decisão 4) recusou fazer backup de `neo4j_data` apoiado numa
 * frase — *o grafo pode ser descartado porque pode ser reconstruído* — cujo
 * mecanismo não existia. Este script é esse mecanismo.
 *
 * Vive em `src/` e não em `apps/api/scripts/` pelo mesmo motivo do
 * `rewrap-deks.ts`: `scripts/` fica fora da imagem, e perder o grafo é coisa
 * que acontece em PRODUÇÃO. Roda como `node scripts/reprojetar-grafo.js`.
 *
 * ## Garantias
 *
 * - **Um tradutor só.** Evento → nó/aresta é o `GraphEventTranslator`, o MESMO
 *   que o `GraphProjector` (o caminho para frente) chama. Este arquivo só sabe
 *   CHEGAR à fonte.
 * - **Idempotente.** Toda gravação é `MERGE` em chave natural; rodar duas
 *   vezes dá o mesmo grafo, e rodar de novo depois de uma falha no meio é o
 *   jeito certo de retomar. Nada é APAGADO: o comando só acrescenta/converge.
 * - **Em lotes, por cursor.** `session_events` é varrida em ordem de `id`
 *   (ULID, ordenado por tempo, e a chave primária — o índice que já existe),
 *   um lote por vez; nunca a tabela inteira na memória. `sessions` terminais
 *   idem, por `id`.
 * - **Não toca na outbox.** O projetor vivo guarda o progresso dele em
 *   `outbox_events.processed_at` (`aggregate_type = 'graph_projection'`), e
 *   esta varredura nem lê nem escreve essa tabela — rodar com a api de pé não
 *   rouba, não reabre e não marca linha nenhuma. As duas escritas concorrentes
 *   são `MERGE` sobre as mesmas chaves.
 *
 * ## Fontes, e o que NÃO sai delas
 *
 * - `handoff.offered`, `psychologist.hypothesis_proposed`,
 *   `anamnese.profile_updated` — de `session_events`.
 * - `Interacao` — de `sessions` em `closed`/`closed_abnormally`: fechar sessão
 *   é transição pura e não deixa evento no log (`transition-session.use-case.ts`).
 * - `PromptTemplate`/`PromptVersion` NÃO vêm do event log e NÃO são
 *   reprojetados aqui: a fonte deles são os arquivos em `prompts/`, reenviados
 *   por `scripts/dev/seed-prompts.ts`.
 *
 * ## Por que o núcleo é uma função exportada
 *
 * Mesmo desenho do `rewrap-deks.ts` (RN-562): `reprojetarGrafo()` é exercitada
 * por teste contra Postgres e Neo4j de verdade, e `main()` — argumentos,
 * conexões, impressão, código de saída — só roda na invocação direta.
 */

const TAMANHO_DO_LOTE = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = NodePgDatabase<typeof schema>;

export interface OpcoesDeReprojecao {
  /** Só as sessões deste projeto. Ausente = o event log inteiro. */
  projectId?: string;
  /** Retoma a varredura de eventos DEPOIS deste id (o cursor que a saída imprime). */
  aposEvento?: string;
  tamanhoDoLote?: number;
  progresso?: (mensagem: string) => void;
  reportarFalha?: (mensagem: string) => void;
}

export interface ResultadoDaReprojecao {
  eventosProjetados: number;
  fechamentosProjetados: number;
  falhas: number;
  /** O último evento lido — o cursor para `--after-event` numa retomada. */
  ultimoEvento: string | null;
}

export class ProjetoInexistenteError extends Error {
  constructor(readonly projectId: string) {
    super(
      `projeto ${projectId} não existe neste banco — nada foi reprojetado. ` +
        'Confira o id (é o uuid de `projects.id`, não o slug).',
    );
    this.name = 'ProjetoInexistenteError';
  }
}

/**
 * O grafo caiu NO MEIO. Carrega o cursor para a mensagem dizer de onde
 * retomar — e retomar do começo também é seguro, só mais lento.
 */
export class ReprojecaoInterrompidaError extends Error {
  constructor(
    readonly ultimoEventoConcluido: string | null,
    readonly cause: unknown,
  ) {
    super(
      'Neo4j ficou indisponível no meio da reprojeção — ' +
        (ultimoEventoConcluido
          ? `último evento concluído: ${ultimoEventoConcluido}. `
          : 'nenhum evento concluído. ') +
        'O que já foi gravado fica; rode de novo (é idempotente).',
    );
    this.name = 'ReprojecaoInterrompidaError';
  }
}

/** Monta o MESMO tradutor que o `GraphProjector` usa, fora do Nest. */
export function montarTradutor(
  db: Db,
  grafo: GraphStore,
): GraphEventTranslator {
  return new GraphEventTranslator(
    new DrizzleSessionEventRepository(db),
    new RecordHandoffUseCase(grafo),
    new RecordHypothesisUseCase(grafo),
    new RecordAnamneseProfileUseCase(grafo),
    new RecordInteractionUseCase(grafo),
  );
}

/**
 * Varre o event log e reprojeta. Não abre nem fecha conexão, não lê ambiente
 * e não sai do processo: quem faz isso é `main()`.
 *
 * Recusa ANTES de ler qualquer coisa quando o grafo não está disponível: com
 * um event log vazio (ou um projeto sem sessão) a varredura não gravaria nada,
 * e o grafo fora do ar sairia como sucesso calado.
 */
export async function reprojetarGrafo(
  db: Db,
  grafo: GraphStore,
  opcoes: OpcoesDeReprojecao = {},
): Promise<ResultadoDaReprojecao> {
  const progresso = opcoes.progresso ?? ((m) => console.log(m));
  const reportarFalha = opcoes.reportarFalha ?? ((m) => console.error(m));
  const lote = opcoes.tamanhoDoLote ?? TAMANHO_DO_LOTE;

  if (!grafo.disponivel) {
    throw new GraphUnavailableError(
      'Neo4j não está configurado ou não conectou (NEO4J_URI/NEO4J_USER/' +
        'NEO4J_PASSWORD) — nada foi reprojetado.',
    );
  }

  const { projectId } = opcoes;
  if (projectId !== undefined) {
    if (!UUID.test(projectId)) throw new ProjetoInexistenteError(projectId);
    const [projeto] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!projeto) throw new ProjetoInexistenteError(projectId);
  }

  const tradutor = montarTradutor(db, grafo);
  const resultado: ResultadoDaReprojecao = {
    eventosProjetados: 0,
    fechamentosProjetados: 0,
    falhas: 0,
    ultimoEvento: opcoes.aposEvento ?? null,
  };

  const sessoesDoProjeto = projectId
    ? db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.projectId, projectId))
    : undefined;

  // Fase 1 — os eventos do log.
  for (;;) {
    const condicoes = [
      inArray(sessionEvents.type, [...EVENTOS_DO_LOG_PROJETAVEIS]),
    ];
    if (resultado.ultimoEvento) {
      condicoes.push(gt(sessionEvents.id, resultado.ultimoEvento));
    }
    if (sessoesDoProjeto) {
      condicoes.push(inArray(sessionEvents.sessionId, sessoesDoProjeto));
    }

    const linhas = await db
      .select()
      .from(sessionEvents)
      .where(and(...condicoes))
      .orderBy(asc(sessionEvents.id))
      .limit(lote);
    if (linhas.length === 0) break;

    for (const linha of linhas) {
      try {
        await tradutor.projetarEvento(toEntity(linha));
        resultado.eventosProjetados += 1;
      } catch (error) {
        if (error instanceof GraphUnavailableError) {
          throw new ReprojecaoInterrompidaError(resultado.ultimoEvento, error);
        }
        // Um payload incoerente não pode abortar a reconstrução do resto: o
        // grafo ficaria pela metade sem ninguém saber quanto faltou. Contado,
        // identificado, e o script sai com código de erro no fim.
        resultado.falhas += 1;
        reportarFalha(
          `[reprojetar] evento ${linha.id} (${linha.type}): ${descreverErro(error)}`,
        );
      }
      resultado.ultimoEvento = linha.id;
    }
    progresso(
      `[reprojetar] eventos: ${resultado.eventosProjetados} projetados, cursor ${resultado.ultimoEvento}`,
    );
  }

  // Fase 2 — as sessões fechadas (a `Interacao`).
  let ultimaSessao: string | null = null;
  for (;;) {
    const condicoes = [
      inArray(sessions.status, [...FECHAMENTOS_DE_SESSAO].map(estadoTerminal)),
    ];
    if (ultimaSessao) condicoes.push(gt(sessions.id, ultimaSessao));
    if (projectId) condicoes.push(eq(sessions.projectId, projectId));

    const linhas = await db
      .select({
        id: sessions.id,
        projectId: sessions.projectId,
        createdBy: sessions.createdBy,
        nextSeq: sessions.nextSeq,
      })
      .from(sessions)
      .where(and(...condicoes))
      .orderBy(asc(sessions.id))
      .limit(lote);
    if (linhas.length === 0) break;

    for (const sessao of linhas) {
      try {
        await tradutor.projetarFechamentoDeSessao(sessao);
        resultado.fechamentosProjetados += 1;
      } catch (error) {
        if (error instanceof GraphUnavailableError) {
          throw new ReprojecaoInterrompidaError(resultado.ultimoEvento, error);
        }
        resultado.falhas += 1;
        reportarFalha(
          `[reprojetar] sessão ${sessao.id}: ${descreverErro(error)}`,
        );
      }
      ultimaSessao = sessao.id;
    }
    progresso(
      `[reprojetar] sessões fechadas: ${resultado.fechamentosProjetados} projetadas`,
    );
  }

  return resultado;
}

/** Contagem do grafo INTEIRO — o que a saída mostra ao operador no fim. */
export async function contarGrafo(
  grafo: GraphStore,
): Promise<{ nos: number; arestas: number }> {
  return grafo.executeRead(async (tx) => {
    const nos = await tx.run('MATCH (n) RETURN count(n) AS total');
    const arestas = await tx.run('MATCH ()-[r]->() RETURN count(r) AS total');
    return {
      nos: nos.records[0].get<number>('total'),
      arestas: arestas.records[0].get<number>('total'),
    };
  });
}

/** `session.closed` → `closed`; `session.closed_abnormally` → `closed_abnormally`. */
function estadoTerminal(tipo: string): 'closed' | 'closed_abnormally' {
  return tipo.slice('session.'.length) as 'closed' | 'closed_abnormally';
}

function descreverErro(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const USO =
  'uso: node scripts/reprojetar-grafo.js [--project <uuid>] [--after-event <id>]';

export function lerArgumentos(argv: string[]): {
  projectId?: string;
  aposEvento?: string;
} {
  const opcoes: { projectId?: string; aposEvento?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const valor = argv[i + 1];
    // `pnpm --filter api grafo:reprojetar -- --project x` repassa o `--`
    // literal ao script (medido): é separador, não argumento.
    if (argv[i] === '--') continue;
    if (argv[i] === '--project' && valor) {
      opcoes.projectId = valor;
      i += 1;
    } else if (argv[i] === '--after-event' && valor) {
      opcoes.aposEvento = valor;
      i += 1;
    } else {
      throw new Error(`argumento não reconhecido: ${argv[i]}\n${USO}`);
    }
  }
  return opcoes;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL é obrigatória');

  const opcoes = lerArgumentos(process.argv.slice(2));

  const grafo = new GraphStore();
  await grafo.onModuleInit();
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });

  let resultado: ResultadoDaReprojecao;
  let contagem: { nos: number; arestas: number };
  try {
    console.log(
      `[reprojetar] escopo: ${opcoes.projectId ? `projeto ${opcoes.projectId}` : 'event log inteiro'}` +
        (opcoes.aposEvento ? `, eventos depois de ${opcoes.aposEvento}` : ''),
    );
    resultado = await reprojetarGrafo(db, grafo, opcoes);
    contagem = await contarGrafo(grafo);
  } finally {
    await pool.end();
    await grafo.onModuleDestroy();
  }

  console.log('\n[reprojetar] resultado\n');
  console.log(
    `  eventos projetados=${resultado.eventosProjetados}  ` +
      `sessões fechadas projetadas=${resultado.fechamentosProjetados}  ` +
      `falhas=${resultado.falhas}`,
  );
  console.log(
    `  grafo agora (inteiro): nós=${contagem.nos}  arestas=${contagem.arestas}`,
  );

  if (resultado.falhas > 0) {
    console.error(
      `\n[reprojetar] ${resultado.falhas} item(ns) não projetaram — ver as linhas acima. ` +
        'O resto foi gravado; corrija e rode de novo (é idempotente).',
    );
    process.exit(1);
  }
}

// Só a INVOCAÇÃO direta reprojeta. Importar este módulo — o que um spec faz
// para exercitar `reprojetarGrafo()` — não pode escrever no grafo.
if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      '[reprojetar] falhou:',
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  });
}
