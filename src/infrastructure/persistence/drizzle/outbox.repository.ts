import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { OutboxRepository } from '../../../application/ports/outbox-repository.port';
import type {
  NewOutboxEvent,
  OutboxEvent,
} from '../../../domain/shared/outbox-event.entity';
import { outboxEvents } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';
import { currentTraceparent } from '../../observability/trace-context';
import { Traced } from '../../observability/traced.decorator';

@Injectable()
export class DrizzleOutboxRepository implements OutboxRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  @Traced('infrastructure')
  async append(input: NewOutboxEvent): Promise<void> {
    const db = currentDb(this.rootDb);

    // O `traceparent` é injetado AQUI, num lugar só, lendo o contexto OTel
    // ativo — e é por isso que os 18 pontos que escrevem no outbox não
    // precisaram mudar. Vazio quando não há trace ativo (migration, seed,
    // processo sem instrumentação), e o consumidor trata a ausência.
    const traceparent = currentTraceparent();

    await db.insert(outboxEvents).values({
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      payload: input.payload,
      metadata: traceparent ? { traceparent } : {},
    });
  }

  @Traced('infrastructure')
  async listUnprocessed(
    aggregateType: string,
    limit: number,
  ): Promise<OutboxEvent[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.aggregateType, aggregateType),
          isNull(outboxEvents.processedAt),
        ),
      )
      .orderBy(asc(outboxEvents.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      eventType: row.eventType,
      payload: row.payload,
      createdAt: row.createdAt,
      processedAt: row.processedAt,
    }));
  }

  @Traced('infrastructure')
  async markProcessed(id: string): Promise<void> {
    const db = currentDb(this.rootDb);
    await db
      .update(outboxEvents)
      .set({ processedAt: new Date() })
      .where(eq(outboxEvents.id, id));
  }
}
