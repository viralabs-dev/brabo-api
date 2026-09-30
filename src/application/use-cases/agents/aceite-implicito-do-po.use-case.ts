import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { AcceptHandoffUseCase } from './accept-handoff.use-case';
import type { Handoff } from '../../../domain/sessions/handoff.entity';
import type { Actor } from '../../../domain/sessions/session-event.entity';
import { decidirAceiteImplicitoDoPo } from '../../../domain/sessions/estou-pronto';

const ATOR_DO_ACEITE_IMPLICITO: Actor = {
  kind: 'system',
  id: 'aceite-implicito',
};

/**
 * O aceite do PO é implícito no "Estou pronto" (RN-658, ADR 0185, AT-312).
 *
 * O handoff Criativo→PO nasce DEPOIS do clique — é o turno que o clique
 * dispara que consolida o `product_brief` e o oferece —, então o aceite não
 * cabe no POST do clique. Ele acontece aqui, logo depois de a oferta ser
 * criada pela rota interna do engine, e passa pelo MESMO
 * `AcceptHandoffUseCase` do card: mesmos eventos (`handoff.accepted`,
 * `agent.activated`, e o `handoff.superseded` das outras ofertas ao PO pela
 * RN-635), mesmo ator humano — quem clicou —, e a marca `implicito` no
 * payload, que diz de qual `readiness.confirmed` o aceite veio.
 *
 * Quando aceitar é `decidirAceiteImplicitoDoPo` (regra pura). Fora dela, a
 * oferta fica `offered` e o card de aceite aparece como sempre.
 *
 * A falha NÃO sobe para o engine: a oferta foi criada, e devolver erro faria o
 * Criativo narrar "não consegui oferecer o handoff" — falso. Ela vira
 * `agent.error` durável, com origem e a frase do que fazer (RN-059). A
 * exceção é o 400 de "handoff não está offered": alguém já decidiu a oferta
 * por outro caminho (o card, noutra aba) no intervalo, e esse desfecho já está
 * no log — não é falha.
 */
@Injectable()
export class AceiteImplicitoDoPoUseCase {
  constructor(
    private readonly sessionEvents: SessionEventRepository,
    private readonly acceptHandoff: AcceptHandoffUseCase,
    private readonly appendEvent: AppendSessionEventUseCase,
  ) {}

  /** Devolve `true` quando o handoff foi aceito aqui. */
  async seCouber(
    projectId: string,
    sessionId: string,
    oferta: Pick<
      Handoff,
      'id' | 'sessionId' | 'fromAgent' | 'toAgent' | 'status' | 'artifactId'
    >,
  ): Promise<boolean> {
    // Barato antes de ler o log: só o handoff da prontidão interessa.
    if (oferta.fromAgent !== 'criativo' || oferta.toAgent !== 'po') {
      return false;
    }

    const [prontidoes, briefs] = await Promise.all([
      this.sessionEvents.listByTypeInSession(sessionId, 'readiness.confirmed'),
      this.sessionEvents.listByTypeInSession(
        sessionId,
        'artifact.product_brief',
      ),
    ]);
    const decisao = decidirAceiteImplicitoDoPo(
      oferta,
      sessionId,
      prontidoes,
      briefs,
    );
    if (!decisao) return false;

    try {
      await this.acceptHandoff.execute(
        projectId,
        sessionId,
        oferta.id,
        decisao.userId,
        undefined,
        decisao.implicito,
      );
      return true;
    } catch (erro) {
      if (erro instanceof BadRequestException) return false;
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      const origem =
        erro instanceof HttpException && erro.getStatus() < 500
          ? 'politica'
          : 'infra';
      await this.appendEvent.execute(projectId, sessionId, {
        type: 'agent.error',
        actor: ATOR_DO_ACEITE_IMPLICITO,
        payload: {
          origem,
          reason: 'aceite_implicito_falhou',
          handoffId: oferta.id,
          mensagem:
            'O "Estou pronto" não conseguiu aceitar o handoff ao PO: ' +
            `${mensagem}. O product brief e a necessidade validada continuam ` +
            'registrados.',
        },
      });
      return false;
    }
  }
}
