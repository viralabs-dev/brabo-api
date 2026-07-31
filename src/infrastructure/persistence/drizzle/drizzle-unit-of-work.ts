import { Inject, Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../../application/ports/unit-of-work.port';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentTx, runWithTransaction } from './drizzle-context';
import { Traced } from '../../observability/traced.decorator';

@Injectable()
export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  @Traced('infrastructure')
  async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    // Já dentro de uma transação (chamada reentrante) — reusa, não
    // abre uma segunda transação/conexão desnecessária.
    if (currentTx()) return work();

    return this.db.transaction((tx) =>
      runWithTransaction(tx as unknown as DrizzleDb, work),
    );
  }
}
