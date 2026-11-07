import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Migra projetos antigos (gitflow, com `dev`) para trunk (RN-1022, ADR 0263):
 * avança a `main` do repositório bare até a ponta da `dev`, só por
 * fast-forward. É gesto do DONO — escrever na `main` é escrita em branch
 * protegida (RN-418) — e roda DEPOIS de nenhuma tarefa estar em andamento.
 *
 * Garantias: nunca apaga `dev`/`qa`; recusa (sem tocar em nada) quando a
 * `main` não é ancestral da `dev`; `--dry-run` só relata. O `update-ref` leva o
 * valor antigo esperado, então um merge concorrente na `main` faz falhar em
 * vez de sobrescrever. PRs abertas com destino `dev` NÃO são redirecionadas
 * aqui (shortcut: sem o PR store; feche-as ou reabra-as contra a `main`).
 *
 * Uso: `pnpm migrar-projeto-para-trunk [--dry-run] [--root <pasta>] [<bare>...]`
 * (sem `<bare>`, varre `*.git` em `--root`, padrão `GIT_LOCAL_REPOS_ROOT`).
 */

export type SituacaoDaMigracao =
  'migrado' | 'simulado' | 'ja_em_trunk' | 'sem_dev' | 'recusado';

export interface ResultadoDaMigracao {
  repo: string;
  situacao: SituacaoDaMigracao;
  detalhe: string;
}

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['--git-dir', repo, ...args]);
  return stdout.trim();
}

async function sha(repo: string, ref: string): Promise<string | null> {
  try {
    return await git(repo, [
      'rev-parse',
      '--verify',
      '--quiet',
      `${ref}^{commit}`,
    ]);
  } catch {
    return null;
  }
}

export async function migrarParaTrunk(
  repo: string,
  opcoes: { dryRun: boolean },
): Promise<ResultadoDaMigracao> {
  const dev = await sha(repo, 'refs/heads/dev');
  const main = await sha(repo, 'refs/heads/main');
  if (!main) {
    return {
      repo,
      situacao: 'recusado',
      detalhe: 'repositório sem a branch main',
    };
  }
  if (!dev) {
    return {
      repo,
      situacao: 'sem_dev',
      detalhe: 'sem dev: já é trunk, nada a fazer',
    };
  }
  if (dev === main) {
    return {
      repo,
      situacao: 'ja_em_trunk',
      detalhe: `main já está em ${main}`,
    };
  }
  try {
    await git(repo, ['merge-base', '--is-ancestor', main, dev]);
  } catch {
    return {
      repo,
      situacao: 'recusado',
      detalhe:
        `não é fast-forward: a main (${main}) não é ancestral da dev (${dev}). ` +
        'Nada foi alterado; resolva a divergência à mão.',
    };
  }
  if (opcoes.dryRun) {
    return {
      repo,
      situacao: 'simulado',
      detalhe: `--dry-run: main ${main} -> ${dev} (fast-forward)`,
    };
  }
  await git(repo, ['update-ref', 'refs/heads/main', dev, main]);
  return { repo, situacao: 'migrado', detalhe: `main ${main} -> ${dev}` };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const iRoot = args.indexOf('--root');
  const root = iRoot >= 0 ? args[iRoot + 1] : process.env.GIT_LOCAL_REPOS_ROOT;
  const explicitos = args.filter(
    (a, i) => !a.startsWith('--') && (iRoot < 0 || i !== iRoot + 1),
  );

  let repos = explicitos;
  if (repos.length === 0) {
    if (!root)
      throw new Error('informe --root <pasta> ou os repositórios bare');
    repos = (await readdir(root))
      .filter((n) => n.endsWith('.git'))
      .map((n) => join(root, n));
  }

  let recusados = 0;
  for (const repo of repos) {
    const r = await migrarParaTrunk(repo, { dryRun });
    if (r.situacao === 'recusado') recusados += 1;
    console.log(`[trunk] ${r.situacao.padEnd(11)} ${r.repo}: ${r.detalhe}`);
  }
  if (recusados > 0) process.exit(1);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('[trunk] falhou:', error);
    process.exit(1);
  });
}
