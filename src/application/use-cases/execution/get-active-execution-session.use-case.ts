import { Injectable } from '@nestjs/common';
import { SessionRepository } from '../../ports/session-repository.port';

/**
 * Devolve a sessão de execução VIGENTE do projeto (ou `null`, quando não há
 * nenhuma) — a mesma leitura que `ActivateExecutionUseCase` já fazia para
 * decidir se reativa ou cria (`findActiveExecutionSession`), agora exposta
 * por HTTP.
 *
 * Existe porque a aba Executores lia `useLatestSession` (a sessão `created_at`
 * mais recente do projeto, sem filtrar por `kind` nem por
 * `execution.activated`) — que É a sessão de execução só por COINCIDÊNCIA.
 * Assim que outra sessão (ex. uma ideação nova) nasce depois, a aba passa a
 * olhar silenciosamente essa sessão vazia, sem pista nenhuma na tela. Esta
 * leitura usa o MESMO critério do backend — `active` e com
 * `execution.activated` gravado — em vez de "a mais recente".
 */
@Injectable()
export class GetActiveExecutionSessionUseCase {
  constructor(private readonly sessions: SessionRepository) {}

  execute(projectId: string) {
    return this.sessions.findActiveExecutionSession(projectId);
  }
}
