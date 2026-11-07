import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * RN-1039 (AT-770): o token do GitHub Packages nunca entra em camada nem em
 * `ARG`/`ENV`; só como secret do BuildKit. O spec lê os arquivos do repo.
 */
const raiz = join(__dirname, '..');
const dockerfile = readFileSync(join(raiz, 'Dockerfile'), 'utf8');

describe('Dockerfile sem token do registry (RN-1039)', () => {
  it('todo `pnpm install` monta o .npmrc como secret do BuildKit', () => {
    const instalacoes = dockerfile
      .split('\n')
      .filter((l) => /^\s*RUN\b.*\bpnpm install\b/.test(l));
    expect(instalacoes.length).toBeGreaterThan(0);
    for (const l of instalacoes) {
      expect(l).toContain('--mount=type=secret,id=npmrc');
    }
  });

  it('nenhum ARG/ENV carrega token', () => {
    const decls = dockerfile
      .split('\n')
      .filter((l) => /^\s*(ARG|ENV)\b/.test(l));
    for (const l of decls) {
      expect(l).not.toMatch(/TOKEN|NPM_CONFIG|NODE_AUTH|_authToken|NPMRC/i);
    }
  });

  it('o .npmrc do repo só diz o registry do escopo, sem token', () => {
    const npmrc = readFileSync(join(raiz, '.npmrc'), 'utf8').trim();
    expect(npmrc).toBe('@viralabs-dev:registry=https://npm.pkg.github.com');
  });
});
