import { Inject, Injectable } from '@nestjs/common';
import { OutboxRepository } from '../../../application/ports/outbox-repository.port';
import type { NewOutboxEvent } from '../../../domain/shared/outbox-event.entity';
import { outboxEvents } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';
import { currentTraceparent } from '../../observability/trace-context';

@Injectable()
export class DrizzleOutboxRepository implements OutboxRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

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
}
