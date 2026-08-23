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
  return { workspaceDirName, executionMode: 'container', workspacePath: null };
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
    await store.addPattern(
      noContainer('project-novo'),
      'allow',
      'Terminal(echo oi)',
    );

    const file = await store.read(noContainer('project-novo'));
    expect(file.allow).toEqual(['Terminal(echo oi)']);
  });

  it('addPattern: idempotente — não duplica se o padrão já estiver na lista', async () => {
    const store = new FsPermissionsFileStore();
    await store.addPattern(
      noContainer('project-2'),
      'allow',
      'Terminal(echo oi)',
    );
    await store.addPattern(
      noContainer('project-2'),
      'allow',
      'Terminal(echo oi)',
    );

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
    await store.addPattern(
      noContainer('project-3'),
      'allow',
      'Terminal(echo oi)',
    );

    const file = await store.read(noContainer('project-3'));
    expect(file.deny).toEqual(['Terminal(rm -rf /)']);
    expect(file.allow).toEqual(['Terminal(echo oi)']);
  });

  /**
   * O modo Pasta montada (RN-169/RN-421): a política é gravada NA PASTA DO
   * USUÁRIO.
   *
   * Este é o teste que prova que a api e o engine continuam concordando — o
   * permissions.json tem que morar na mesma raiz que o escopo de terminal
   * autoriza, e nos modos `mounted`/`runner` essa raiz é a pasta do usuário.
   * Se ele caísse na raiz gerenciada, a política seria lida de um lugar e
   * aplicada a outro.
   */
  it('projeto mounted: o permissions.json mora na pasta do usuário, não na gerenciada', async () => {
    const pastaDoUsuario = await mkdtemp(
      join(tmpdir(), 'brabo-pasta-usuario-'),
    );
    try {
      const store = new FsPermissionsFileStore();
      const local: ProjectWorkspaceLocation = {
        workspaceDirName: 'loja-3f2b1c8e',
        executionMode: 'mounted',
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

  /**
   * `move` — a conversão de `execution_mode` de um projeto EXISTENTE
   * (RN-448, ADR 0111). O CONTEÚDO sobrevive; só o CAMINHO muda.
   */
  it('move: conteúdo sobrevive, escrito no destino e apagado da origem', async () => {
    const store = new FsPermissionsFileStore();
    const origem = noContainer('projeto-1');
    const destino = {
      workspaceDirName: 'projeto-1',
      executionMode: 'mounted' as const,
      workspacePath: await mkdtemp(join(tmpdir(), 'brabo-move-destino-')),
    };
    try {
      await store.write(origem, {
        allow: ['Terminal(echo oi)'],
        deny: [],
        ask: [],
      });

      await store.move(origem, destino);

      const noDestino = await store.read(destino);
      expect(noDestino.allow).toEqual(['Terminal(echo oi)']);

      // A origem não tem mais o arquivo (apagado, best-effort).
      await expect(
        readFile(join(root, 'projeto-1', 'permissions.json'), 'utf-8'),
      ).rejects.toThrow();
    } finally {
      await rm(destino.workspacePath, { recursive: true, force: true });
    }
  });

  it('move: origem sem arquivo (projeto que nunca teve "sempre permitir") grava vazio no destino, sem lançar', async () => {
    const store = new FsPermissionsFileStore();
    const origem = noContainer('projeto-sem-permissions');
    const pastaDestino = await mkdtemp(
      join(tmpdir(), 'brabo-move-destino-vazio-'),
    );
    const destino = {
      workspaceDirName: 'projeto-sem-permissions',
      executionMode: 'runner' as const,
      workspacePath: pastaDestino,
    };

    try {
      await store.move(origem, destino);

      const noDestino = await store.read(destino);
      expect(noDestino).toEqual(EMPTY_PERMISSIONS_FILE);
    } finally {
      await rm(pastaDestino, { recursive: true, force: true });
    }
  });

  it('move: from === to (mesma raiz efetiva) é no-op', async () => {
    const store = new FsPermissionsFileStore();
    const local = noContainer('projeto-9');
    await store.write(local, {
      allow: ['Terminal(echo oi)'],
      deny: [],
      ask: [],
    });

    await store.move(local, { ...local });

    const depois = await store.read(local);
    expect(depois.allow).toEqual(['Terminal(echo oi)']);
  });
});
