import { Injectable, Logger } from '@nestjs/common';
import { SessionChannelNotifier } from '../../application/ports/session-channel-notifier.port';
import { CABECALHO_SERVICE_TOKEN } from '../../interfaces/http/auth/engine-service.guard';
import { tokenDeServicoAtual } from '../security/service-token';
import { injectTraceHeaders } from '../observability/trace-context';
import {
  aposCommit,
  veioDoEngine,
} from '../persistence/drizzle/drizzle-context';

const TETO_DA_CHAMADA_MS = 2000;

/**
 * AT-344: a URL do aviso, ou `null` quando o `sessionId` não é um UUID.
 *
 * O id de sessão é `uuid` no banco, então é essa a forma aceita — nada de
 * `/`, `..`, `?`, `#`, `@` ou `%` chega ao caminho. A guarda é um teste de
 * regex ANCORADA no MESMO escopo que monta a URL (antes ela morava no chamador
 * e o valor atravessava uma closure de `aposCommit`, onde a análise do CodeQL
 * perdia a guarda e acusava `js/request-forgery`). Por cima dela, o segmento
 * vai por `encodeURIComponent` e a URL montada precisa manter a ORIGEM do
 * `ENGINE_URL` e o caminho esperado: o host nunca vem do usuário.
 */
export function urlDoAvisoDeEvento(
  engineUrl: string,
  sessionId: string,
): URL | null {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      sessionId,
    )
  ) {
    return null;
  }
  let base: URL;
  try {
    base = new URL(engineUrl);
  } catch {
    return null;
  }
  const segmento = encodeURIComponent(sessionId);
  const prefixo = base.pathname.replace(/\/+$/, '');
  const caminho = `${prefixo}/internal/sessions/${segmento}/event-appended`;
  const url = new URL(caminho, base.origin);
  if (url.origin !== base.origin || url.pathname !== caminho) return null;
  return url;
}

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
    const engineUrl = process.env.ENGINE_URL ?? 'http://localhost:4000';
    const url = urlDoAvisoDeEvento(engineUrl, sessionId);
    if (url === null) return;
    aposCommit(() => {
      void this.enviar(url, type, actorId);
    });
  }

  private async enviar(
    url: URL,
    type: string,
    actorId: string | undefined,
  ): Promise<void> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: injectTraceHeaders({
          'Content-Type': 'application/json',
          [CABECALHO_SERVICE_TOKEN]: tokenDeServicoAtual(),
        }),
        body: JSON.stringify({ type, actorId: actorId ?? '' }),
        signal: AbortSignal.timeout(TETO_DA_CHAMADA_MS),
      });
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
