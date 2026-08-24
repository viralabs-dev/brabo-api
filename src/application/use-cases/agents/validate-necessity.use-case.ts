import { BadRequestException, Injectable } from '@nestjs/common';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';

/**
 * Fecha o gate de saída `necessidade-validada` do Criativo
 * (`docs/fluxo.yml`, papel `criativo`), até aqui declarado `proposto` sem
 * mecanismo nenhum atrás (auditoria fluxo.yml × código, achado B2 — RN-406,
 * ADR 0095).
 *
 * O `modelo-de-time.md` já registrava o anti-padrão que este desenho evita:
 * o Criativo (o modelo) decidir sozinho que a necessidade que ELE MESMO
 * produziu está validada seria autovalidação, não gate de verdade. A
 * confirmação é SEMPRE um clique deliberado do usuário — nunca inferência do
 * modelo, nunca reaproveitamento silencioso de `confirm_readiness`
 * (RN-142, que continua sendo só o piso estrutural "≥1 regra capturada") nem
 * do aceite estrutural do handoff pelo PO (`AcceptHandoffUseCase`, que não
 * julga o CONTEÚDO do que aceita).
 *
 * Pré-condição: só faz sentido "validar" um `product_brief` que já existe —
 * a consolidação das regras de negócio que `confirm_readiness` já produziu
 * e cujo handoff ao PO `CriativoServer.executar_confirm_readiness/1` já
 * ofereceu. Sem `artifact.product_brief` na sessão, recusa: não há o que
 * validar ainda.
 *
 * Diferente de `OfferInfraHandoffUseCase` (RN-160/ADR 0086), esta
 * confirmação NÃO sinaliza o engine: o handoff Criativo→PO já aconteceu
 * dentro do próprio `confirm_readiness`, e não há nenhum agente esperando
 * por este evento para agir — ele é só o registro de que um humano validou
 * a necessidade antes dela seguir adiante.
 */
@Injectable()
export class ValidateNecessityUseCase {
  constructor(
    private readonly sessionEvents: SessionEventRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
  ) {}

  async execute(projectId: string, sessionId: string, userId: string) {
    const briefs = await this.sessionEvents.listByTypeInSession(
      sessionId,
      'artifact.product_brief',
    );
    const brief = briefs.at(-1);
    if (!brief) {
      throw new BadRequestException(
        'Confirme "Estou pronto para produzir" com o Criativo antes de validar a necessidade (RN-406): nenhum product_brief foi produzido nesta sessão ainda.',
      );
    }

    await this.appendEvent.execute(projectId, sessionId, {
      type: 'necessity.validated',
      actor: { kind: 'user', id: userId },
      payload: { productBriefId: brief.id },
    });

    return { ok: true as const };
  }
}
