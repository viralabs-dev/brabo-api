import type { ProjectWorkspaceLocation } from '../../domain/iam/project.entity';

/**
 * A escrita da projeção de artefatos em `docs/` (ADR 0148, RN-523).
 *
 * Não é repositório de domínio (não fala com o Postgres) — é acesso a disco,
 * atrás de porta pelo mesmo motivo que `PermissionsFileStore`: testável sem
 * tocar filesystem de verdade, e substituível se um dia a projeção precisar ir
 * para outro lugar.
 *
 * Recebe a LOCALIZAÇÃO do workspace, nunca `projectId`: é o par (modo,
 * caminho) que responde onde a pasta mora, e nos três modos a resposta é
 * diferente — ver `pastaDeArtefatosDoProjeto`, que é quem sabe disso.
 */
export abstract class ArtifactFileStore {
  /**
   * Grava um artefato. `agente` e `arquivo` já vêm em forma de slug de
   * `domain/artifacts/artifact-projection-events.ts` — esta porta não deriva
   * nome, ela escreve o que recebe, e é a implementação que garante que nada
   * escape da pasta.
   *
   * Sobrescrever é o comportamento correto para tipo VERSIONADO (o arquivo
   * mostra o vigente) e nunca acontece para append-only, cujo nome carrega o
   * `seq` do evento.
   */
  abstract write(
    local: ProjectWorkspaceLocation,
    agente: string,
    arquivo: string,
    conteudo: string,
  ): Promise<void>;
}
