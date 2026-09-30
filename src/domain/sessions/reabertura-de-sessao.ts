// A reabertura de sessão encerrada (ADR 0183, RN-649/RN-650).
//
// Puro e sem framework, como `session-state-machine.ts` e
// `conversa-em-sessao-encerrada.ts`: quem traduz a recusa para 409 é a camada
// de aplicação.
//
// ## Por que sessão com execução NÃO reabre (padrão provisório)
//
// `findActiveExecutionSession` escolhe a `active` MAIS RECENTE que carrega um
// `execution.activated` (RN-139). Reabrir uma sessão velha de execução a
// devolveria a essa busca, e a próxima reativação poderia desviar os dev
// agents para ela — ou para a outra, conforme a data de criação. O caminho
// declarado para "voltar a executar" continua sendo abrir sessão nova e
// ativar a execução nela. É o padrão CONSERVADOR à espera do dono (ADR 0183).

import type { SessionStatus } from './session-state-machine';

/** O tipo do evento que a reabertura grava, no mesmo `seq` da sessão. */
export const EVENTO_DE_REABERTURA = 'session.reopened';

/** O evento que marca a sessão como de execução (RN-097/RN-139). */
export const EVENTO_QUE_IMPEDE_REABRIR = 'execution.activated';

export class SessaoComExecucaoNaoReabreError extends Error {
  /** O `reason` do corpo do 409 — o nome que a web reconhece. */
  static readonly REASON = 'sessao_com_execucao';

  constructor(readonly status: SessionStatus) {
    super(
      'Esta sessão ativou a execução e não pode ser reaberta: os dev agents ' +
        'procuram a sessão de execução vigente do projeto, e reabrir esta ' +
        'poderia desviá-los para ela. Para voltar a executar, abra uma sessão ' +
        'nova e ative a execução nela.',
    );
    this.name = 'SessaoComExecucaoNaoReabreError';
  }
}

/**
 * Lança `SessaoComExecucaoNaoReabreError` quando a sessão já carrega um
 * `execution.activated`. O estado (terminal ou não) é decidido pela máquina de
 * estados (`assertReopen`), não aqui.
 */
export function garantirQueSessaoSemExecucaoReabre(
  status: SessionStatus,
  temExecucao: boolean,
): void {
  if (temExecucao) throw new SessaoComExecucaoNaoReabreError(status);
}

/**
 * O payload de `session.reopened`: o que a coluna perde ao reabrir. `closed_at`
 * e `termination_reason` são limpos na linha de `sessions` (a sessão está
 * `active` de novo), e sem esta cópia o QUANDO e o PORQUÊ do fechamento
 * anterior sumiriam. O `session.closed` nunca foi linha de `session_events`
 * (é outbox), então é este evento que o guarda no log da sessão.
 */
export function payloadDaReabertura(anterior: {
  status: SessionStatus;
  closedAt: Date | null;
  terminationReason: string | null;
}): Record<string, unknown> {
  return {
    from: anterior.status,
    to: 'active',
    closedAt: anterior.closedAt ? anterior.closedAt.toISOString() : null,
    terminationReason: anterior.terminationReason,
  };
}
