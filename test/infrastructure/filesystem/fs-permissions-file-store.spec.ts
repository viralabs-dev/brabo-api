import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsPermissionsFileStore } from '../../../src/infrastructure/filesystem/fs-permissions-file-store';
import { EMPTY_PERMISSIONS_FILE } from '../../../src/domain/actions/permissions-file';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'brabo-project-workspaces-test-'));
  process.env.PROJECT_WORKSPACES_ROOT = root;
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe('FsPermissionsFileStore', () => {
  it('read: projeto sem arquivo cai no default vazio, sem lançar', async () => {
    const store = new FsPermissionsFileStore();
    const file = await store.read('project-sem-arquivo');
    expect(file).toEqual(EMPTY_PERMISSIONS_FILE);
  });

  it('write + read: grava e lê de volta o conteúdo real do disco', async () => {
    const store = new FsPermissionsFileStore();
    await store.write('project-1', {
      allow: ['Terminal(echo oi)'],
      deny: [],
      ask: [],
    });

    const file = await store.read('project-1');
    expect(file.allow).toEqual(['Terminal(echo oi)']);

    const raw = await readFile(
      join(root, 'project-1', 'permissions.json'),
      'utf-8',
    );
    const parsed = JSON.parse(raw) as { allow: string[] };
    expect(parsed.allow).toEqual(['Terminal(echo oi)']);
  });

  it('addPattern: cria o diretório e o arquivo do zero se ainda não existirem', async () => {
    const store = new FsPermissionsFileStore();
    await store.addPattern('project-novo', 'allow', 'Terminal(echo oi)');

    const file = await store.read('project-novo');
    expect(file.allow).toEqual(['Terminal(echo oi)']);
  });

  it('addPattern: idempotente — não duplica se o padrão já estiver na lista', async () => {
    const store = new FsPermissionsFileStore();
    await store.addPattern('project-2', 'allow', 'Terminal(echo oi)');
    await store.addPattern('project-2', 'allow', 'Terminal(echo oi)');

    const file = await store.read('project-2');
    expect(file.allow).toEqual(['Terminal(echo oi)']);
  });

  it('addPattern: preserva as outras listas ao adicionar em uma delas', async () => {
    const store = new FsPermissionsFileStore();
    await store.write('project-3', {
      allow: [],
      deny: ['Terminal(rm -rf /)'],
      ask: [],
    });
    await store.addPattern('project-3', 'allow', 'Terminal(echo oi)');

    const file = await store.read('project-3');
    expect(file.deny).toEqual(['Terminal(rm -rf /)']);
    expect(file.allow).toEqual(['Terminal(echo oi)']);
  });
});
