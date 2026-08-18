import { BadRequestException, Injectable } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { StoryRepository } from '../../ports/backlog-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';

/**
 * O usuário confirma que a arquitetura está pronta (Fase 4a — fechamento):
 * mirror de ConfirmReadinessUseCase, mas endpoint DEDICADO (não reaproveita
 * o de readiness — agente e momento diferentes). Grava
 * `architecture.readiness_confirmed` e sinaliza o engine, que só então
 * instrui o Arquiteto a oferecer o handoff ao InfraAgent.
 *
 * RN-160 revalidada aqui (auditoria fluxo.yml x código, item B6): a UI
 * (`SessionPage.tsx`, `hasPromotedStory`) já desabilita o botão sem
 * história promovida, mas uma chamada HTTP direta ignorava a regra por
 * completo — quem tem autoridade final é o backend, não o cliente.
 */
@Injectable()
export class OfferInfraHandoffUseCase {
  constructor(
    private readonly engineClient: ApiToEngineClient,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly storyRepository: StoryRepository,
  ) {}

  async execute(projectId: string, sessionId: string, userId: string) {
    const stories = await this.storyRepository.findByProject(projectId);
    const haHistoriaPromovida = stories.some(
      (story) => story.status !== 'draft',
    );
    if (!haHistoriaPromovida) {
      throw new BadRequestException(
        'Confirme com pelo menos uma história promovida do backlog (RN-160): nenhuma história deste projeto saiu de "draft".',
      );
    }

    await this.appendEvent.execute(projectId, sessionId, {
      type: 'architecture.readiness_confirmed',
      actor: { kind: 'user', id: userId },
      payload: {},
    });

    await this.engineClient.offerInfraHandoff(projectId, sessionId);

    // FASE 14d (ADR 0053): a MESMA confirmação também entrega ao Dev Lead. A
    // cadeia vira Arquiteto → Dev Lead → execução, e antes disto não havia
    // ninguém entre o fim da arquitetura e o botão de ativar.
    //
    // Chamadas SEPARADAS, e a de dev vem depois: são duas áreas com desfechos
    // independentes, e uma falha do Dev Lead não pode desfazer o handoff de
    // Infra que já foi aceito — o event log não retrata.
    await this.engineClient.offerDevHandoff(projectId, sessionId);

    return { ok: true as const };
  }
}
