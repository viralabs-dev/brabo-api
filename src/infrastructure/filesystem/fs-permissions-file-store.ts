import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { projectScopeRoot } from './project-workspaces-root';
import { Injectable } from '@nestjs/common';
import { PermissionsFileStore } from '../../application/ports/permissions-file-store.port';
import {
  EMPTY_PERMISSIONS_FILE,
  type PermissionsFile,
} from '../../domain/actions/permissions-file';
import type { ProjectWorkspaceLocation } from '../../domain/iam/project.entity';

@Injectable()
export class FsPermissionsFileStore implements PermissionsFileStore {
  async read(local: ProjectWorkspaceLocation): Promise<PermissionsFile> {
    try {
      const raw = await readFile(this.pathFor(local), 'utf-8');
      return JSON.parse(raw) as PermissionsFile;
    } catch (error) {
      if (isNotFound(error)) return EMPTY_PERMISSIONS_FILE;
      throw error;
    }
  }

  async write(
    local: ProjectWorkspaceLocation,
    file: PermissionsFile,
  ): Promise<void> {
    const path = this.pathFor(local);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(file, null, 2));
  }

  async addPattern(
    local: ProjectWorkspaceLocation,
    list: keyof PermissionsFile,
    pattern: string,
  ): Promise<void> {
    const current = await this.read(local);
    if (current[list].includes(pattern)) return;
    await this.write(local, {
      ...current,
      [list]: [...current[list], pattern],
    });
  }

  // A raiz vem da função compartilhada, e não de uma leitura própria do env:
  // o escopo de caminho do ADR 0055 deriva a MESMA raiz, e duas leituras
  // separadas poderiam divergir — política lida de um lugar, aplicada a outro.
  private pathFor(local: ProjectWorkspaceLocation): string {
    return join(projectScopeRoot(local), 'permissions.json');
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
