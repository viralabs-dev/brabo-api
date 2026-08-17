/**
 * dbre — linter de risco de migration (docs/fluxo.yml, papel `dbre`,
 * entregável `parecer-de-migracao`).
 *
 * Uso: `pnpm --filter api lint:migracao`
 *
 * ## O que ele é, e o que ele NÃO é
 *
 * Análise ESTÁTICA de texto SQL, sem banco e sem `--projeto`: varre todo
 * `apps/api/src/db/migrations/*.sql` procurando padrões de risco conhecidos —
 * perda de dado irreversível e operação que pode travar/reescrever tabela
 * grande. Ele NÃO sabe quantas linhas as tabelas do repositório gerenciado
 * têm, então não avalia IMPACTO real, só ACHA o padrão e diz por que ele é
 * arriscado — é o "parecer" do dbre, não um veredito automático de
 * bloqueio.
 *
 * Não confundir com a regra de "UMA migration por onda"
 * (`meta/_journal.json`, CLAUDE.md): aquela evita CONFLITO de snapshot entre
 * agentes em paralelo. Este script detecta padrão arriscado DENTRO do SQL de
 * uma migration — são preocupações ortogonais, e nenhuma substitui a outra.
 *
 * ## Por que ele NÃO entrou no CI (ainda)
 *
 * O script varre o REPOSITÓRIO INTEIRO de migrations, não o diff de uma PR.
 * Rodá-lo contra as migrations reais de hoje ACHA ocorrências em migrations
 * já mergeadas e aceitas (0006, 0007, 0034 — ver docs/adr/0093, seção
 * Consequências): wirear isso como step bloqueante no CI faria TODA PR falhar
 * para sempre, por um achado que não é dela. Torná-lo um gate de verdade
 * exige a mesma técnica de `scripts/ci/pr-police.ts` — escopar ao diff contra
 * a base do PR — que fica para quando o dbre precisar de fato bloquear
 * merge, não hoje. Por ora é script MANUAL, para o parecer humano antes de um
 * `git push`.
 *
 * ## Desenho
 *
 * `lintarConteudo` é PURA (recebe nome + texto do SQL, devolve achados) —
 * mesmo desenho de `scripts/ci/pr-police.ts` (`avaliarPr`) e
 * `scripts/medir-execucao.ts`: lógica testável sem processo, sem I/O.
 * `lintarDiretorio`/`principal` são o adaptador: leem o disco e decidem o
 * código de saída.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type PadraoDeRisco =
  | 'drop_table'
  | 'truncate'
  | 'drop_column'
  | 'alter_column_type'
  | 'add_column_not_null_sem_default';

export interface Achado {
  arquivo: string;
  linha: number;
  padrao: PadraoDeRisco;
  trecho: string;
  mensagem: string;
}

interface RegraDeRisco {
  padrao: PadraoDeRisco;
  mensagem: string;
  bate: (linha: string) => boolean;
}

/**
 * Cada regra opera sobre UMA linha. É suficiente contra o corpus real: todo
 * `.sql` gerado pelo drizzle-kit no repositório hoje tem uma cláusula por
 * linha, terminada em `;` (às vezes com `--> statement-breakpoint` colado na
 * mesma linha) — nunca `DROP COLUMN`/`ALTER COLUMN ... TYPE`/`ADD COLUMN`
 * partido em várias linhas. Se isso mudar um dia, o teste de "múltiplos
 * achados numa mesma migration" é o lugar óbvio para crescer para análise por
 * statement (`--> statement-breakpoint`), não aqui.
 */
const REGRAS: readonly RegraDeRisco[] = [
  {
    padrao: 'drop_table',
    mensagem:
      'DROP TABLE apaga a tabela inteira, com todos os dados — irreversível sem backup/restore (ver `pnpm --filter api relatorio:backup`).',
    bate: (linha) => /\bDROP\s+TABLE\b/i.test(linha),
  },
  {
    padrao: 'truncate',
    mensagem:
      'TRUNCATE apaga todas as linhas da tabela — irreversível sem backup/restore (ver `pnpm --filter api relatorio:backup`).',
    bate: (linha) => /\bTRUNCATE\b/i.test(linha),
  },
  {
    padrao: 'drop_column',
    mensagem:
      'DROP COLUMN apaga a coluna e os dados nela — irreversível sem backup/restore manual. Considere reter a coluna por uma release antes de apagar.',
    bate: (linha) => /\bDROP\s+COLUMN\b/i.test(linha),
  },
  {
    padrao: 'alter_column_type',
    mensagem:
      'ALTER COLUMN ... TYPE pode exigir reescrever a tabela inteira — lock e tempo proporcionais ao volume de linhas.',
    bate: (linha) =>
      /\bALTER\s+COLUMN\b/i.test(linha) &&
      /\b(SET\s+DATA\s+TYPE|TYPE)\b/i.test(linha),
  },
  {
    padrao: 'add_column_not_null_sem_default',
    mensagem:
      'ADD COLUMN ... NOT NULL sem DEFAULT falha contra uma tabela que já tem linhas — adicione nullable, faça backfill, só então torne NOT NULL (padrão usado em 0042_tough_captain_midlands.sql).',
    bate: (linha) =>
      /\bADD\s+COLUMN\b/i.test(linha) &&
      /\bNOT\s+NULL\b/i.test(linha) &&
      !/\bDEFAULT\b/i.test(linha),
  },
];

const TAMANHO_MAX_TRECHO = 160;

/**
 * Lógica PURA: recebe o nome do arquivo (só para rotular o achado) e o texto
 * do SQL, devolve os achados. Sem I/O, sem `process`.
 *
 * Linha comentária (começa com `--` depois de aparada) é ignorada de
 * propósito: comentários deste repositório citam os próprios padrões de risco
 * em prosa para explicar a decisão (ex.: 0042_tough_captain_midlands.sql,
 * linha 3, explica por que a migration NÃO fez `ADD COLUMN ... NOT NULL` sem
 * default) — analisar o texto do comentário acharia o padrão na explicação de
 * por que ele foi EVITADO.
 */
export function lintarConteudo(arquivo: string, conteudo: string): Achado[] {
  const achados: Achado[] = [];

  conteudo.split('\n').forEach((linhaBruta, indice) => {
    const linha = linhaBruta.trim();
    if (linha.length === 0 || linha.startsWith('--')) return;

    for (const regra of REGRAS) {
      if (!regra.bate(linha)) continue;
      achados.push({
        arquivo,
        linha: indice + 1,
        padrao: regra.padrao,
        trecho:
          linha.length > TAMANHO_MAX_TRECHO
            ? `${linha.slice(0, TAMANHO_MAX_TRECHO)}…`
            : linha,
        mensagem: regra.mensagem,
      });
    }
  });

  return achados;
}

/** Nomes dos `.sql`, em ordem — a mesma ordem que `_journal.json` registra. */
export function listarMigrations(diretorio: string): string[] {
  return readdirSync(diretorio)
    .filter((nome) => nome.endsWith('.sql'))
    .sort();
}

/** Adaptador de I/O: lê o diretório de migrations e aplica a lógica pura. */
export function lintarDiretorio(diretorio: string): Achado[] {
  const achados: Achado[] = [];
  for (const nome of listarMigrations(diretorio)) {
    const conteudo = readFileSync(join(diretorio, nome), 'utf8');
    achados.push(...lintarConteudo(nome, conteudo));
  }
  return achados;
}

function imprimir(achados: Achado[]): void {
  if (achados.length === 0) {
    console.log('[lint-migracao] nenhum padrão de risco encontrado.');
    return;
  }

  console.log(
    `[lint-migracao] ${achados.length} achado(s) — informativo, não corrige migration já mergeada:\n`,
  );
  for (const a of achados) {
    console.log(`  ${a.arquivo}:${a.linha} [${a.padrao}]`);
    console.log(`    ${a.trecho}`);
    console.log(`    → ${a.mensagem}\n`);
  }
}

function principal(): void {
  const diretorio = join(__dirname, '..', 'src', 'db', 'migrations');
  const achados = lintarDiretorio(diretorio);
  imprimir(achados);
  process.exit(achados.length > 0 ? 1 : 0);
}

// Só roda como CLI — mesma guarda de `scripts/medir-execucao.ts`, para que
// importar as funções puras no teste não dispare a varredura nem o exit.
if (process.argv[1]?.endsWith('lint-migracao.ts')) principal();
