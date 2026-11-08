import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** AT-850 / RN-1065: a marca `BRABO_AMBIENTE` da imagem sai da tag; só a final é `prd`. */
const wf = (n: string) =>
  readFileSync(join(__dirname, '../../.github/workflows', n), 'utf8');

/** Corpo do `run: |` do passo `name`, sem o recuo. */
function passo(yml: string, name: string): string {
  const linhas = yml.split('\n');
  const i = linhas.findIndex((l) => l.includes(`- name: ${name}`));
  const ri = linhas.findIndex((l, k) => k > i && /^\s+run: \|\s*$/.test(l));
  const recuo = linhas[ri + 1].match(/^\s*/)![0].length;
  const corpo: string[] = [];
  for (
    let k = ri + 1;
    k < linhas.length &&
    (linhas[k].trim() === '' || linhas[k].match(/^\s*/)![0].length >= recuo);
    k++
  ) {
    corpo.push(linhas[k].slice(recuo));
  }
  return corpo.join('\n');
}

function ambienteDoRelease(ref: string | null): string {
  const out = join(mkdtempSync(join(tmpdir(), 'marca-')), 'out');
  execFileSync('bash', ['-c', passo(wf('release.yml'), 'A versão')], {
    env: {
      PATH: process.env.PATH!,
      GITHUB_OUTPUT: out,
      GITHUB_REF_NAME: ref ?? '',
      PUBLICAR: ref ? 'true' : 'false',
    },
  });
  return /^ambiente=(.*)$/m.exec(readFileSync(out, 'utf8'))![1];
}

describe('marca BRABO_AMBIENTE da imagem', () => {
  it('tag -dev dá dev', () =>
    expect(ambienteDoRelease('v1.4.0-dev.17')).toBe('dev'));
  it('ensaio (sem tag) dá dev', () =>
    expect(ambienteDoRelease(null)).toBe('dev'));
  it('tag final dá prd', () => expect(ambienteDoRelease('v1.4.0')).toBe('prd'));

  it('ci.yml: a imagem sha- da PR dá dev', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'marca-')), 'out');
    execFileSync('bash', ['-c', passo(wf('ci.yml'), 'Tag sha-<12>')], {
      env: {
        PATH: process.env.PATH!,
        GITHUB_OUTPUT: out,
        TAG_SHA: 'sha-0123456789abcdef0123',
      },
    });
    expect(readFileSync(out, 'utf8')).toContain('ambiente=dev');
  });

  it('o build-arg vem do passo, nunca de um prd fixo', () => {
    for (const n of ['release.yml', 'ci.yml']) {
      expect(wf(n)).toContain('BRABO_AMBIENTE=${{ steps.v.outputs.ambiente }}');
      expect(wf(n)).not.toMatch(/BRABO_AMBIENTE=prd/);
    }
  });
});
