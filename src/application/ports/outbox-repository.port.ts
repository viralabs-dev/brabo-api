import type { NewOutboxEvent } from '../../domain/shared/outbox-event.entity';

export abstract class OutboxRepository {
  abstract append(input: NewOutboxEvent): Promise<void>;
}
