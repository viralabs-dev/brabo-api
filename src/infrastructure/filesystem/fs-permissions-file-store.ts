import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { projectScopeRoot } from './project-workspaces-root';
import { Injectable } from '@nestjs/common';
import { PermissionsFileStore } from '../../application/ports/permissions-file-store.port';
import {
  EMPTY_PERMISSIONS_FILE,
  type PermissionsFile,
} from '../../domain/actions/permissions-file';

@Injectable()
export class FsPermissionsFileStore implements PermissionsFileStore {
  async read(workspaceDirName: string): Promise<PermissionsFile> {
    try {
      const raw = await readFile(this.pathFor(workspaceDirName), 'utf-8');
      return JSON.parse(raw) as PermissionsFile;
    } catch (error) {
      if (isNotFound(error)) return EMPTY_PERMISSIONS_FILE;
      throw error;
    }
  }

  async write(workspaceDirName: string, file: PermissionsFile): Promise<void> {
    const path = this.pathFor(workspaceDirName);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(file, null, 2));
  }

  async addPattern(
    workspaceDirName: string,
    list: keyof PermissionsFile,
    pattern: string,
  ): Promise<void> {
    const current = await this.read(workspaceDirName);
    if (current[list].includes(pattern)) return;
    await this.write(workspaceDirName, {
      ...current,
      [list]: [...current[list], pattern],
    });
  }

  // A raiz vem da função compartilhada, e não de uma leitura própria do env:
  // o escopo de caminho do ADR 0055 deriva a MESMA raiz, e duas leituras
  // separadas poderiam divergir — política lida de um lugar, aplicada a outro.
  private pathFor(workspaceDirName: string): string {
    return join(projectScopeRoot(workspaceDirName), 'permissions.json');
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}
