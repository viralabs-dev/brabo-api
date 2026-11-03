import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import {
  ChatAttachmentRepository,
  type ChatAttachmentRow,
} from '../../../application/ports/chat-attachment-repository.port';
import { chatAttachments } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleChatAttachmentRepository implements ChatAttachmentRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async create(input: Omit<ChatAttachmentRow, 'id'>) {
    const [row] = await currentDb(this.rootDb)
      .insert(chatAttachments)
      .values(input)
      .returning({ id: chatAttachments.id });
    return row;
  }

  async find(projectId: string, sessionId: string, id: string) {
    const [row] = await currentDb(this.rootDb)
      .select()
      .from(chatAttachments)
      .where(
        and(
          eq(chatAttachments.id, id),
          eq(chatAttachments.projectId, projectId),
          eq(chatAttachments.sessionId, sessionId),
        ),
      );
    return row ?? null;
  }

  async findManyMeta(projectId: string, sessionId: string, ids: string[]) {
    if (ids.length === 0) return [];
    return currentDb(this.rootDb)
      .select({
        id: chatAttachments.id,
        projectId: chatAttachments.projectId,
        sessionId: chatAttachments.sessionId,
        autorId: chatAttachments.autorId,
        nome: chatAttachments.nome,
        mime: chatAttachments.mime,
        tamanho: chatAttachments.tamanho,
      })
      .from(chatAttachments)
      .where(
        and(
          inArray(chatAttachments.id, ids),
          eq(chatAttachments.projectId, projectId),
          eq(chatAttachments.sessionId, sessionId),
        ),
      );
  }
}
