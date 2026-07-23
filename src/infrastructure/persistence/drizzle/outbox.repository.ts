import { Inject, Injectable } from '@nestjs/common';
import { OutboxRepository } from '../../../application/ports/outbox-repository.port';
import type { NewOutboxEvent } from '../../../domain/shared/outbox-event.entity';
import { outboxEvents } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleOutboxRepository implements OutboxRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async append(input: NewOutboxEvent): Promise<void> {
    const db = currentDb(this.rootDb);
    await db.insert(outboxEvents).values({
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      payload: input.payload,
    });
  }
}
