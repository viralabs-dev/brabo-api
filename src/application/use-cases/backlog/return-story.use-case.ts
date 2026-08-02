import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { StoryRepository } from '../../ports/backlog-repository.port';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';

/**
 * Recusa de promoção (Fase 12c, RN-048): o usuário devolve a história ao PO
 * com um comentário, e ela volta a ser trabalho DELE — não uma pendência
 * parada na fila do usuário.
 *
 * Espelha a devolução de gate ao dev (`QaLeadServer` → `DevAgentServer.correct`)
 * de propósito: o motivo vira mensagem fixada na sessão do agente, com a mesma
 * frase de precedência. A diferença é o meio — o gate roda dentro do engine e
 * chama o dev em processo; a recusa nasce numa rota HTTP da api e precisa
 * atravessar a fronteira.
 */
@Injectable()
export class ReturnStoryUseCase {
  private readonly logger = new Logger(ReturnStoryUseCase.name);

  constructor(
    private readonly stories: StoryRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly engineClient: ApiToEngineClient,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(
    projectId: string,
    storyId: string,
    reason: string,
    userId: string,
  ) {
    const story = await this.stories.findById(storyId);
    if (!story || story.projectId !== projectId) {
      throw new NotFoundException('História não encontrada');
    }

    // A recusa é gravada ANTES de falar com o engine — o inverso da ordem do
    // `RearmDevAgentUseCase`, e por um motivo que vale a pena registrar: lá o
    // evento (`dev.rearmed`) é uma afirmação SOBRE O ENGINE, que seria mentira
    // no log se o engine recusasse. Aqui o evento é uma afirmação sobre o
    // USUÁRIO — ele recusou, e isso é verdade tenha ou não um PO de pé para
    // ouvir. Perder a decisão porque o processo do agente morreu seria devolver
    // o usuário ao começo sem razão nenhuma.
    await this.unitOfWork.runInTransaction(async () => {
      await this.stories.markReturned(storyId, reason);
      await this.appendEvent.execute(projectId, story.sessionId, {
        type: 'backlog.story_promotion_returned',
        actor: { kind: 'user', id: userId },
        payload: { storyId, title: story.title, reason },
      });
    });

    // FORA da transação: um round-trip HTTP segurando conexão do pool esgota
    // o pool sob carga (mesma razão do `postComment` no gate). E best-effort
    // porque o PO pode ter morrido com o restart do engine — a história já
    // está devolvida e visível no backlog; o que se perde é a notificação
    // imediata ao agente, não a decisão.
    try {
      await this.engineClient.reviseStory(
        projectId,
        story.sessionId,
        storyId,
        story.title,
        reason,
      );
    } catch (erro) {
      this.logger.warn(
        `história ${storyId} devolvida, mas o PO da sessão ${story.sessionId} ` +
          `não foi notificado: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
    }

    return { ok: true as const };
  }
}
