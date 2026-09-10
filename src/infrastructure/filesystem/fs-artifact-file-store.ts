import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ArtifactFileStore } from '../../application/ports/artifact-file-store.port';
import type { ProjectWorkspaceLocation } from '../../domain/iam/project.entity';
import { pastaDeArtefatosDoProjeto } from './project-workspaces-root';

/**
 * A escrita em disco da projeção de artefatos (ADR 0148).
 *
 * `pastaDeArtefatosDoProjeto` é quem sabe ONDE a pasta mora nos três modos de
 * execução (e por que `runner` desvia para a raiz gerenciada) — derivar o
 * caminho aqui seria a segunda derivação que um dia diverge, o mesmo argumento
 * do comentário de `FsPermissionsFileStore.pathFor`.
 */
@Injectable()
export class FsArtifactFileStore implements ArtifactFileStore {
  async write(
    local: ProjectWorkspaceLocation,
    agente: string,
    arquivo: string,
    conteudo: string,
  ): Promise<void> {
    const raiz = pastaDeArtefatosDoProjeto(local);
    const destino = join(raiz, agente, arquivo);

    // SEGUNDA barreira, e ela existe apesar de `slugDeArquivo` já produzir um
    // alfabeto fechado. O nome nasce de payload de LLM, e as duas defesas
    // respondem perguntas diferentes: lá é "que nome eu DERIVO disto", aqui é
    // "o que eu vou de fato abrir". Confiar só na primeira faria a segurança
    // desta escrita depender de nenhuma futura mudança de slug jamais deixar
    // passar um separador — que é a forma de contenção que o ADR 0130 recusa
    // por princípio: a que depende de o chamador estar correto.
    const dentro = relative(raiz, destino);
    if (dentro.startsWith('..') || isAbsolute(dentro)) {
      throw new Error(
        `caminho de artefato escaparia da pasta do projeto: ${agente}/${arquivo}`,
      );
    }

    await mkdir(join(raiz, agente), { recursive: true });
    await writeFile(destino, conteudo, 'utf-8');
  }
}
