/** Append-only (RN-1316): não existe `update` nem `delete` aqui, de propósito. */
export abstract class MergeAutomaticoEventoRepository {
  abstract registrar(input: {
    projectId: string;
    userId: string;
    habilitado: boolean;
  }): Promise<void>;
}
