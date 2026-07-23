import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalGitProvider } from '../../../src/infrastructure/git/local-git-provider';

const execFileAsync = promisify(execFile);

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'brabo-git-repos-test-'));
  process.env.GIT_LOCAL_REPOS_ROOT = root;
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe('LocalGitProvider', () => {
  it('caminho feliz: cria um repositório bare de verdade', async () => {
    const provider = new LocalGitProvider();

    const result = await provider.createRepository({
      name: 'Meu Repo de Teste',
      visibility: 'private',
    });

    expect(result.externalId).toContain('meu-repo-de-teste.git');
    expect(result.defaultBranch).toBe('main');

    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--is-bare-repository'],
      { cwd: result.externalId },
    );
    expect(stdout.trim()).toBe('true');
  });
});
