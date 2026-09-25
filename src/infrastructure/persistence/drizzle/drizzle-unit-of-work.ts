import { Inject, Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../../application/ports/unit-of-work.port';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import {
  currentTx,
  runWithPosCommit,
  runWithTransaction,
} from './drizzle-context';
import { Traced } from '../../observability/traced.decorator';

@Injectable()
export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  @Traced('infrastructure')
  async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    // Já dentro de uma transação (chamada reentrante) — reusa, não
    // abre uma segunda transação/conexão desnecessária.
    if (currentTx()) return work();

    // AT-157: o que foi pedido para depois do commit roda SÓ se a transação
    // mais externa confirmou. Erro numa ação pós-commit nunca falha a
    // escrita, que já está no banco.
    const pendentes: Array<() => void> = [];
    const resultado = await this.db.transaction((tx) =>
      runWithPosCommit(pendentes, () =>
        runWithTransaction(tx as unknown as DrizzleDb, work),
      ),
    );
    for (const acao of pendentes) {
      try {
        acao();
      } catch {
        // melhor esforço
      }
    }
    return resultado;
  }
}
