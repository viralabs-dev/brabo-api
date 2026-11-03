export interface ChatAttachmentRow {
  id: string;
  projectId: string;
  sessionId: string;
  autorId: string;
  nome: string;
  mime: string;
  tamanho: number;
  bytes: Buffer;
}

export type ChatAttachmentMeta = Omit<ChatAttachmentRow, 'bytes'>;

export abstract class ChatAttachmentRepository {
  abstract create(
    input: Omit<ChatAttachmentRow, 'id'>,
  ): Promise<{ id: string }>;
  /** Escopado ao projeto E à sessão: alheio é `null`. */
  abstract find(
    projectId: string,
    sessionId: string,
    id: string,
  ): Promise<ChatAttachmentRow | null>;
  /** Só metadados (sem bytes) dos ids pedidos, na sessão. */
  abstract findManyMeta(
    projectId: string,
    sessionId: string,
    ids: string[],
  ): Promise<ChatAttachmentMeta[]>;
}
