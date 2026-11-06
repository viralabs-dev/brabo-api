import { describe, expect, it } from 'vitest';
import { ehEfeitoDeAcao } from '../../../../src/application/efeito-de-acao';
import { InternalOpenQuestionsController } from '../../../../src/interfaces/http/internal/internal-open-questions.controller';
import type { PerguntasEmAbertoUseCase } from '../../../../src/application/use-cases/backlog/perguntas-em-aberto.use-case';

/**
 * AT-753 (UX-1, RN-1002): o fechamento interno da pergunta roda como efeito de
 * ação, senão o `HttpSessionChannelNotifier` fica calado em `/internal/*` e o
 * contador "Perguntas em aberto" do web não atualiza.
 */
describe('InternalOpenQuestionsController.answer', () => {
  it('fecha a pergunta marcada como efeito de ação (o canal é avisado)', async () => {
    let marcado: boolean | undefined;
    const perguntas = {
      responderPeloAgente: async () => {
        await Promise.resolve(); // a marca precisa sobreviver ao await
        marcado = ehEfeitoDeAcao();
        return { status: 'answered' };
      },
    } as unknown as PerguntasEmAbertoUseCase;

    const out = await new InternalOpenQuestionsController(perguntas).answer(
      'p1',
      'q1',
      { sessionId: 's1', agentId: 'a1' },
    );

    expect(out).toEqual({ status: 'answered' });
    expect(marcado).toBe(true);
    expect(ehEfeitoDeAcao()).toBe(false);
  });
});
