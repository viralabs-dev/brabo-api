import type { ProjectMirrorState } from '../../domain/iam/mirror-state';

/** Um desfecho BEM-SUCEDIDO de rodada do espelho, como o runner o contou. */
export interface RecordMirrorSuccessInput {
  projectId: string;
  /** O destino resolvido na máquina do usuário — congelado na linha. */
  destination: string;
  filesCopied: number;
  filesSkipped: number;
  filesRefused: number;
  syncedAt: Date;
}

/** Um desfecho de FALHA — recusa da guarda, git ausente, cópia que explodiu. */
export interface RecordMirrorFailureInput {
  projectId: string;
  /**
   * O destino que a rodada TENTOU usar, quando se sabe. `null` quando a falha
   * é justamente sobre o destino (não concedido naquela conexão, por exemplo).
   */
  destination: string | null;
  error: string;
  failedAt: Date;
}

/**
 * A telemetria da última rodada do espelho (RN-517, ADR 0147 ponto 7).
 *
 * Porta SEPARADA de `ProjectRepository`, pelo mesmo critério que separou
 * `RagTelemetryRepository` de `ChunkRepository`: `projects` é a configuração
 * (o destino declarado, RN-515) e esta é a OBSERVAÇÃO de copiar para ele.
 * Juntar as duas faria toda leitura de projeto arrastar a telemetria junto, e
 * a telemetria é a única das duas cuja falha não pode derrubar nada.
 *
 * **Dois métodos de escrita, e não um upsert com tudo opcional.** Sucesso e
 * falha gravam conjuntos de colunas DISJUNTOS, e é isso que garante que uma
 * falha nunca apaga a última sincronização boa e que um sucesso nunca apaga o
 * último erro (quem decide qual está vigente é `deriveMirrorSyncStatus`, sobre
 * os dois carimbos). Um método só, com todos os campos opcionais, tornaria
 * esse invariante uma convenção do chamador — e convenção de chamador é
 * exatamente o que se quebra numa refatoração.
 */
export abstract class MirrorStateRepository {
  /** `null` = nunca sincronizou. É um dos TRÊS estados, não "não achei". */
  abstract findByProject(projectId: string): Promise<ProjectMirrorState | null>;

  abstract recordSuccess(
    input: RecordMirrorSuccessInput,
  ): Promise<ProjectMirrorState>;

  abstract recordFailure(
    input: RecordMirrorFailureInput,
  ): Promise<ProjectMirrorState>;
}
