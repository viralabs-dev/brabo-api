import { Injectable, Logger } from '@nestjs/common';
import { SessionChannelNotifier } from '../../application/ports/session-channel-notifier.port';
import { CABECALHO_SERVICE_TOKEN } from '../../interfaces/http/auth/engine-service.guard';
import { tokenDeServicoAtual } from '../security/service-token';
import { injectTraceHeaders } from '../observability/trace-context';
import {
  aposCommit,
  veioDoEngine,
} from '../persistence/drizzle/drizzle-context';

const SEGMENTO_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;
const TETO_DA_CHAMADA_MS = 2000;

/**
 * AT-157 (RN-579): pede ao engine que faça o `event.appended` no canal da
 * sessão para uma escrita que a API fez por conta própria.
 *
 * - Só depois do commit (`aposCommit`) e nunca da escrita recusada.
 * - Não avisa quando a escrita veio do engine (`/internal/*`): a fachada dele
 *   já avisa, e o aviso em dobro só gastaria uma chamada.
 * - Melhor esforço, sem esperar: a chamada não é aguardada e a falha é
 *   engolida (log em `debug`). O canal é gatilho; se o aviso se perder a tela
 *   chega pelo poll de fallback, exatamente como antes.
 */
@Injectable()
export class HttpSessionChannelNotifier extends SessionChannelNotifier {
  private readonly logger = new Logger(HttpSessionChannelNotifier.name);

  eventAppended(
    sessionId: string,
    type: string,
    actorId: string | undefined,
  ): void {
    if (veioDoEngine()) return;
    if (!SEGMENTO_VALIDO.test(sessionId)) return;
    aposCommit(() => {
      void this.enviar(sessionId, type, actorId);
    });
  }

  private async enviar(
    sessionId: string,
    type: string,
    actorId: string | undefined,
  ): Promise<void> {
    const engineUrl = process.env.ENGINE_URL ?? 'http://localhost:4000';
    try {
      const res = await fetch(
        `${engineUrl}/internal/sessions/${sessionId}/event-appended`,
        {
          method: 'POST',
          headers: injectTraceHeaders({
            'Content-Type': 'application/json',
            [CABECALHO_SERVICE_TOKEN]: tokenDeServicoAtual(),
          }),
          body: JSON.stringify({ type, actorId: actorId ?? '' }),
          signal: AbortSignal.timeout(TETO_DA_CHAMADA_MS),
        },
      );
      if (!res.ok) {
        this.logger.debug(
          `aviso ao canal recusado pelo engine: ${res.status} (${type})`,
        );
      }
    } catch (error) {
      this.logger.debug(
        `aviso ao canal não entregue (${type}): ${String(error)}`,
      );
    }
  }
}
