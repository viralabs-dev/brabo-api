import { Injectable, Logger } from '@nestjs/common';
import {
  RagTelemetryRepository,
  type NewSourceClick,
} from '../../ports/rag-telemetry-repository.port';

/**
 * O clique numa fonte consultada (RN-983). Gravar a medição nunca derruba o
 * que ela mede: falha vira log de origem `infra` e `null` explícito, e o
 * clique navega do mesmo jeito. Não é voto — não toca `rag_feedback`.
 */
@Injectable()
export class RecordSourceClickUseCase {
  private readonly logger = new Logger(RecordSourceClickUseCase.name);

  constructor(private readonly telemetry: RagTelemetryRepository) {}

  async execute(input: NewSourceClick): Promise<{ id: string } | null> {
    try {
      return await this.telemetry.recordSourceClick(input);
    } catch (erro) {
      this.logger.error(
        `[origem: infra] clique em fonte não foi gravado no projeto ${input.projectId}: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
      return null;
    }
  }
}
