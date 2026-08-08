import { describe, it, expect, afterEach } from 'vitest';
import {
  projectScopeRoot,
  projectWorkspacesRoot,
} from '../../../src/infrastructure/filesystem/project-workspaces-root';

/**
 * Contenção do escopo de projeto (CodeQL `js/path-injection`).
 *
 * O `projectId` chega de um parâmetro de rota sem pipe de validação e o Express
 * já decodificou o percent-encoding — `..%2F..%2Fetc` chega como `../../etc`.
 * Sem a checagem, o `join` resolvia para fora da raiz em silêncio, e isso
 * atingia tanto o `permissions.json` quanto o escopo que AUTORIZA comando de
 * terminal (ADR 0055).
 */

// Montado por código, e não escrito literalmente, porque um NUL cru no fonte
// faz o git tratar o arquivo como binário — o diff some da revisão.
const NUL = String.fromCharCode(0);

describe('projectScopeRoot', () => {
  afterEach(() => {
    delete process.env.PROJECT_WORKSPACES_ROOT;
  });

  it('caminho feliz: um UUID vira pasta sob a raiz', () => {
    process.env.PROJECT_WORKSPACES_ROOT = '/var/brabo';
    expect(projectScopeRoot('3f2b1c8e-0a5d-4f6b-9c1e-2d7a8b3c4d5e')).toBe(
      '/var/brabo/3f2b1c8e-0a5d-4f6b-9c1e-2d7a8b3c4d5e',
    );
  });

  it.each([
    ['..', 'o pai direto'],
    ['../../etc', 'travessia relativa — o que `..%2F..%2Fetc` vira'],
    ['a/b', 'separador no meio'],
    ['/etc/passwd', 'caminho absoluto'],
    ['.', 'a própria raiz'],
    ['', 'vazio, que faria o escopo ser a raiz inteira'],
    [`proj${NUL}eto`, 'byte NUL, que trunca o caminho no syscall'],
  ])('RECUSA %j — %s', (projectId) => {
    expect(() => projectScopeRoot(projectId)).toThrow(/projectId inválido/);
  });

  it('nenhum id aceito escapa da raiz', () => {
    process.env.PROJECT_WORKSPACES_ROOT = '/var/brabo';
    for (const id of ['abc', 'A-1_b', '0'.repeat(64)]) {
      expect(projectScopeRoot(id).startsWith('/var/brabo/')).toBe(true);
    }
  });

  it('a raiz tem default de desenvolvimento e é lida do ambiente', () => {
    expect(projectWorkspacesRoot()).toBe('/tmp/brabo-project-workspaces');
    process.env.PROJECT_WORKSPACES_ROOT = '/var/brabo';
    expect(projectWorkspacesRoot()).toBe('/var/brabo');
  });
});
