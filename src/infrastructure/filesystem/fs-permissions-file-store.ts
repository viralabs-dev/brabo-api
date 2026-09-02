import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { permissionsFilePath } from './project-workspaces-root';
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

  async move(
    from: ProjectWorkspaceLocation,
    to: ProjectWorkspaceLocation,
  ): Promise<void> {
    const fromPath = this.pathFor(from);
    const toPath = this.pathFor(to);
    if (fromPath === toPath) return;

    // `read` já degrada para `EMPTY_PERMISSIONS_FILE` quando o arquivo de
    // origem não existe — um projeto que nunca acumulou "sempre permitir"
    // não tem permissions.json físico, e a conversão não deve falhar por
    // isso: ela grava um vazio no destino, que é o mesmo estado que um
    // projeto nesse modo teria se tivesse nascido ali.
    const conteudo = await this.read(from);
    await this.write(to, conteudo);

    // Apagar a origem é limpeza, não correção — best-effort. Se o arquivo já
    // não existir (o caso comum, "leu vazio"), não há nada a apagar.
    try {
      await unlink(fromPath);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  // O caminho vem da função compartilhada, e não de uma derivação própria:
  // ela é quem sabe que o arquivo acompanha o escopo do ADR 0055 nos modos
  // `container`/`mounted` e vai para a raiz GERENCIADA no modo `runner`
  // (RN-478) — ali a pasta do usuário não é bind-mount, e este processo, que
  // ESCREVE o arquivo, não a alcança. Derivar aqui seria a segunda derivação
  // que um dia diverge: política lida de um lugar, aplicada a outro.
  private pathFor(local: ProjectWorkspaceLocation): string {
    return permissionsFilePath(local);
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
