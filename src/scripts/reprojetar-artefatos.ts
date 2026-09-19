import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import * as schema from '../db/schema';
import { projects, sessionEvents, sessions } from '../db/schema';
import { ARTIFACT_PROJECTABLE_EVENT_TYPES } from '../domain/artifacts/artifact-projection-events';
import { ArtifactEventTranslator } from '../application/artifact-projection/artifact-event-translator';
import type { ArtifactFileStore } from '../application/ports/artifact-file-store.port';
import { FsArtifactFileStore } from '../infrastructure/filesystem/fs-artifact-file-store';
import { toEntity } from '../infrastructure/persistence/drizzle/session-event.repository';
import type { Project } from '../domain/iam/project.entity';

/**
 * Reconstrói a pasta `docs/` dos projetos a partir do event log — o mecanismo
 * que o ADR 0148 declarou ausente ("não existe hoje comando de reprojeção") e
 * a RN-590. Ver docs/runbook.md, seção "Losing the artifact folder".
 *
 * Mesmo desenho de `reprojetar-grafo.ts` (RN-569), e vive em `src/` pelo mesmo
 * motivo: `scripts/` fica fora da imagem. Roda como
 * `node scripts/reprojetar-artefatos.js`.
 *
 * ## Garantias
 *
 * - **Um tradutor só.** Evento -> arquivo é o `ArtifactEventTranslator`, o
 *   MESMO que o `ArtifactProjector` chama. Este arquivo só sabe CHEGAR à fonte.
 * - **Idempotente.** O nome do arquivo é função do evento (versionado:
 *   `<tipo>.md`; append-only: com o `seq`), então rodar de novo regrava os
 *   mesmos arquivos com o mesmo conteúdo. Retomar é rodar de novo.
 * - **Em lotes, por cursor.** `session_events` é varrida em ordem de `id`
 *   (ULID, a chave primária), um lote por vez.
 * - **Nunca apaga.** Só escreve. Arquivo que o usuário criou em `docs/`, ou de
 *   um tipo que deixou de ser projetável, fica.
 * - **Não toca na outbox.** O projetor vivo guarda o progresso em
 *   `outbox_events.processed_at` (`aggregate_type = 'artifact_projection'`);
 *   esta varredura nem lê nem escreve essa tabela.
 *
 * ## Versionados: a ordem é o mecanismo
 *
 * `module_map`, `module_routing`, `project_image` e `c4_diagram` escrevem
 * SEMPRE o mesmo arquivo, e a pasta mostra o vigente. A varredura em ordem de
 * `id` faz o último evento emitido ser o último a escrever — o mesmo que o
 * projetor vivo faz. Por isso `--after-event` no meio de um versionado pode
 * deixar a pasta numa versão que não é a última: retomar do cursor só é
 * equivalente a rodar do começo para os tipos append-only.
 *
 * ## Onde a pasta cai
 *
 * Onde `pastaDeArtefatosDoProjeto` disser: quem roda este script precisa
 * enxergar o MESMO disco que a api (mesma imagem, mesmos volumes e
 * `PROJECT_WORKSPACES_ROOT`/`BRABO_PROJECTS_BASE`). Rodar de outra máquina
 * grava numa pasta que ninguém abre.
 */

const TAMANHO_DO_LOTE = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = NodePgDatabase<typeof schema>;

export interface OpcoesDeReprojecaoDeArtefatos {
  /** Só as sessões deste projeto. Ausente = o event log inteiro. */
  projectId?: string;
  /** Retoma a varredura DEPOIS deste id de evento (o cursor que a saída imprime). */
  aposEvento?: string;
  tamanhoDoLote?: number;
  /** Onde escrever. Padrão: o `FsArtifactFileStore` de produção. */
  arquivos?: ArtifactFileStore;
  progresso?: (mensagem: string) => void;
  reportarFalha?: (mensagem: string) => void;
}

export interface ResultadoDaReprojecaoDeArtefatos {
  artefatosProjetados: number;
  falhas: number;
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
 * Varre o event log e reescreve a pasta. Não abre nem fecha conexão, não lê
 * ambiente e não sai do processo: quem faz isso é `main()`.
 *
 * Diferente do grafo, não há "destino indisponível" que pare tudo: falha de
 * escrita é do ITEM (ADR 0148), então é contada, nomeada, e o script sai com 1
 * no fim — nunca sucesso calado.
 */
export async function reprojetarArtefatos(
  db: Db,
  opcoes: OpcoesDeReprojecaoDeArtefatos = {},
): Promise<ResultadoDaReprojecaoDeArtefatos> {
  const progresso = opcoes.progresso ?? ((m) => console.log(m));
  const reportarFalha = opcoes.reportarFalha ?? ((m) => console.error(m));
  const lote = opcoes.tamanhoDoLote ?? TAMANHO_DO_LOTE;

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

  const tradutor = new ArtifactEventTranslator(
    opcoes.arquivos ?? new FsArtifactFileStore(),
  );
  const resultado: ResultadoDaReprojecaoDeArtefatos = {
    artefatosProjetados: 0,
    falhas: 0,
    ultimoEvento: opcoes.aposEvento ?? null,
  };
  const projetos = new Map<string, Project | null>();

  for (;;) {
    const condicoes = [
      inArray(sessionEvents.type, [...ARTIFACT_PROJECTABLE_EVENT_TYPES]),
    ];
    if (resultado.ultimoEvento) {
      condicoes.push(gt(sessionEvents.id, resultado.ultimoEvento));
    }
    if (projectId) condicoes.push(eq(sessions.projectId, projectId));

    const linhas = await db
      .select({ evento: sessionEvents, projectId: sessions.projectId })
      .from(sessionEvents)
      .innerJoin(sessions, eq(sessions.id, sessionEvents.sessionId))
      .where(and(...condicoes))
      .orderBy(asc(sessionEvents.id))
      .limit(lote);
    if (linhas.length === 0) break;

    for (const linha of linhas) {
      const { evento } = linha;
      try {
        let projeto = projetos.get(linha.projectId);
        if (projeto === undefined) {
          const [row] = await db
            .select()
            .from(projects)
            .where(eq(projects.id, linha.projectId));
          projeto = (row as Project | undefined) ?? null;
          projetos.set(linha.projectId, projeto);
        }
        if (!projeto) {
          throw new Error(`projeto ${linha.projectId} não existe mais`);
        }
        await tradutor.projetarEvento(projeto, toEntity(evento), evento.type);
        resultado.artefatosProjetados += 1;
      } catch (error) {
        // Um item ruim (nome, pasta inalcançável, disco cheio) não pode
        // abortar a reconstrução do resto: contado, identificado, exit 1.
        resultado.falhas += 1;
        reportarFalha(
          `[reprojetar-artefatos] evento ${evento.id} (${evento.type}): ${descreverErro(error)}`,
        );
      }
      resultado.ultimoEvento = evento.id;
    }
    progresso(
      `[reprojetar-artefatos] artefatos: ${resultado.artefatosProjetados} projetados, cursor ${resultado.ultimoEvento}`,
    );
  }

  return resultado;
}

function descreverErro(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const USO =
  'uso: node scripts/reprojetar-artefatos.js [--project <uuid>] [--after-event <id>]';

export function lerArgumentos(argv: string[]): {
  projectId?: string;
  aposEvento?: string;
} {
  const opcoes: { projectId?: string; aposEvento?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const valor = argv[i + 1];
    // `pnpm ... artefatos:reprojetar -- --project x` repassa o `--` literal.
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
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });

  let resultado: ResultadoDaReprojecaoDeArtefatos;
  try {
    console.log(
      `[reprojetar-artefatos] escopo: ${opcoes.projectId ? `projeto ${opcoes.projectId}` : 'event log inteiro'}` +
        (opcoes.aposEvento ? `, eventos depois de ${opcoes.aposEvento}` : ''),
    );
    resultado = await reprojetarArtefatos(db, opcoes);
  } finally {
    await pool.end();
  }

  console.log('\n[reprojetar-artefatos] resultado\n');
  console.log(
    `  artefatos projetados=${resultado.artefatosProjetados}  falhas=${resultado.falhas}`,
  );

  if (resultado.falhas > 0) {
    console.error(
      `\n[reprojetar-artefatos] ${resultado.falhas} item(ns) não projetaram — ver as linhas acima. ` +
        'O resto foi gravado; corrija e rode de novo (é idempotente).',
    );
    process.exit(1);
  }
}

// Só a INVOCAÇÃO direta reprojeta; importar (o spec) não escreve em disco.
if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      '[reprojetar-artefatos] falhou:',
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  });
}
