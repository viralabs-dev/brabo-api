import type { Logger } from '@nestjs/common';
import type { ApiToEngineClient } from '../../ports/api-to-engine-client.port';

/**
 * A queda das conexões vivas abertas com um Personal Access Token revogado
 * (ADR 0201, RN-685) — compartilhada pelas DUAS portas de revogação de PAT
 * (a do dono, RN-426, e a do `maintainer`, RN-427).
 *
 * Até o ADR 0201 revogar um PAT só impedia ticket NOVO: a identidade da
 * credencial morria no `PatAuthGuard`, e o único alvo que existia era o par
 * `{projeto, usuário}`, que derrubaria também a chave de dispositivo do mesmo
 * dono. Com a credencial gravada no ticket, o alvo é o PAT e só ele.
 *
 * Sem alcance LEGADO, de propósito: a conexão aberta antes do ADR 0201 não
 * caía por revogação de PAT, e fazê-la cair pelo par agora derrubaria quem
 * não tem nada com este token. Sem PLANO B pelo mesmo motivo.
 *
 * Nunca lança — a revogação já está gravada quando se chega aqui, e o
 * `DELETE` é idempotente (a régua da RN-479/RN-517).
 */
export async function derrubarConexoesDoPat(
  engine: ApiToEngineClient,
  logger: Logger,
  patId: string,
): Promise<void> {
  try {
    const balanco = await engine.disconnectRunnerCredential(
      { tipo: 'pat', id: patId },
      null,
    );
    logger.log(
      `Token ${patId} revogado: ${balanco.derrubados} conexão(ões) dele ` +
        `derrubada(s), ${balanco.ticketsAnulados} ticket(s) pendente(s) anulado(s)`,
    );
  } catch (erro) {
    logger.warn(
      `Token ${patId} revogado, mas a desconexão das conexões dele não pôde ` +
        `ser pedida ao engine: ${erro instanceof Error ? erro.message : String(erro)}`,
    );
  }
}
