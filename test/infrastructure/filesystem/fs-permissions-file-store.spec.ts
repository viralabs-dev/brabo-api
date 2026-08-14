import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsPermissionsFileStore } from '../../../src/infrastructure/filesystem/fs-permissions-file-store';
import { EMPTY_PERMISSIONS_FILE } from '../../../src/domain/actions/permissions-file';
import type { ProjectWorkspaceLocation } from '../../../src/domain/iam/project.entity';

/**
 * O store passou a receber a LOCALIZAÇÃO do workspace (RN-169), e não mais só
 * o nome da pasta: desde o ADR 0072 é o par (modo, caminho) que responde onde
 * o permissions.json mora.
 */
function noContainer(workspaceDirName: string): ProjectWorkspaceLocation {
  return { workspaceDirName, workspaceMode: 'container', workspacePath: null };
}

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
    const file = await store.read(noContainer('project-sem-arquivo'));
    expect(file).toEqual(EMPTY_PERMISSIONS_FILE);
  });

  it('write + read: grava e lê de volta o conteúdo real do disco', async () => {
    const store = new FsPermissionsFileStore();
    await store.write(noContainer('project-1'), {
      allow: ['Terminal(echo oi)'],
      deny: [],
      ask: [],
    });

    const file = await store.read(noContainer('project-1'));
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
    await store.addPattern(noContainer('project-novo'), 'allow', 'Terminal(echo oi)');

    const file = await store.read(noContainer('project-novo'));
    expect(file.allow).toEqual(['Terminal(echo oi)']);
  });

  it('addPattern: idempotente — não duplica se o padrão já estiver na lista', async () => {
    const store = new FsPermissionsFileStore();
    await store.addPattern(noContainer('project-2'), 'allow', 'Terminal(echo oi)');
    await store.addPattern(noContainer('project-2'), 'allow', 'Terminal(echo oi)');

    const file = await store.read(noContainer('project-2'));
    expect(file.allow).toEqual(['Terminal(echo oi)']);
  });

  it('addPattern: preserva as outras listas ao adicionar em uma delas', async () => {
    const store = new FsPermissionsFileStore();
    await store.write(noContainer('project-3'), {
      allow: [],
      deny: ['Terminal(rm -rf /)'],
      ask: [],
    });
    await store.addPattern(noContainer('project-3'), 'allow', 'Terminal(echo oi)');

    const file = await store.read(noContainer('project-3'));
    expect(file.deny).toEqual(['Terminal(rm -rf /)']);
    expect(file.allow).toEqual(['Terminal(echo oi)']);
  });

  /**
   * O modo Local (RN-169): a política é gravada NA PASTA DO USUÁRIO.
   *
   * Este é o teste que prova que a api e o engine continuam concordando — o
   * permissions.json tem que morar na mesma raiz que o escopo de terminal
   * autoriza, e no modo Local essa raiz é a pasta do usuário. Se ele caísse na
   * raiz gerenciada, a política seria lida de um lugar e aplicada a outro.
   */
  it('projeto Local: o permissions.json mora na pasta do usuário, não na gerenciada', async () => {
    const pastaDoUsuario = await mkdtemp(join(tmpdir(), 'brabo-pasta-usuario-'));
    try {
      const store = new FsPermissionsFileStore();
      const local: ProjectWorkspaceLocation = {
        workspaceDirName: 'loja-3f2b1c8e',
        workspaceMode: 'local',
        workspacePath: pastaDoUsuario,
      };

      await store.addPattern(local, 'allow', 'Terminal(echo oi)');

      const raw = await readFile(
        join(pastaDoUsuario, 'permissions.json'),
        'utf-8',
      );
      expect((JSON.parse(raw) as { allow: string[] }).allow).toEqual([
        'Terminal(echo oi)',
      ]);
      // E nada foi escrito na raiz gerenciada, que é o outro lado da prova.
      await expect(
        readFile(join(root, 'loja-3f2b1c8e', 'permissions.json'), 'utf-8'),
      ).rejects.toThrow();
    } finally {
      await rm(pastaDoUsuario, { recursive: true, force: true });
    }
  });
});
