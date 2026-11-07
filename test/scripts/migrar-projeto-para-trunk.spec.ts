import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrarParaTrunk } from '../../src/scripts/migrar-projeto-para-trunk';

let dir: string;
let bare: string;
let work: string;

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};
const g = (cwd: string, ...a: string[]) =>
  execFileSync('git', a, { cwd, env, encoding: 'utf8' }).trim();
const ref = (r: string) => g(bare, 'rev-parse', r);
function commit(branch: string, msg: string) {
  if (g(work, 'branch', '--show-current') !== branch)
    g(work, 'checkout', '-q', branch);
  g(work, 'commit', '-q', '--allow-empty', '-m', msg);
  g(work, 'push', '-q', 'origin', branch);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trunk-'));
  bare = join(dir, 'p.git');
  work = join(dir, 'w');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  execFileSync('git', ['clone', '-q', bare, work], { env });
  g(work, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  commit('main', 'base');
  g(work, 'checkout', '-q', '-b', 'dev');
  commit('dev', 'trabalho');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('migrarParaTrunk (RN-1022)', () => {
  it('avança a main até a dev por fast-forward e não apaga a dev', async () => {
    const r = await migrarParaTrunk(bare, { dryRun: false });
    expect(r.situacao).toBe('migrado');
    expect(ref('main')).toBe(ref('dev'));
    expect(ref('refs/heads/dev')).toBeTruthy();
  });

  it('--dry-run relata e não move a main', async () => {
    const antes = ref('main');
    const r = await migrarParaTrunk(bare, { dryRun: true });
    expect(r.situacao).toBe('simulado');
    expect(ref('main')).toBe(antes);
  });

  it('recusa quando a main divergiu da dev (não é fast-forward)', async () => {
    commit('main', 'so na main');
    const antes = ref('main');
    const r = await migrarParaTrunk(bare, { dryRun: false });
    expect(r.situacao).toBe('recusado');
    expect(r.detalhe).toContain('não é fast-forward');
    expect(ref('main')).toBe(antes);
  });

  it('projeto já trunk (sem dev) não muda nada', async () => {
    g(bare, 'branch', '-D', 'dev');
    const antes = ref('main');
    const r = await migrarParaTrunk(bare, { dryRun: false });
    expect(r.situacao).toBe('sem_dev');
    expect(ref('main')).toBe(antes);
  });
});
