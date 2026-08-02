import { Injectable } from '@nestjs/common';
import { StoryRepository } from '../../ports/backlog-repository.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { TransitionStoryUseCase } from './transition-story.use-case';

export interface PromocaoRecusada {
  storyId: string;
  reason: string;
}

export interface PromoteStoriesResult {
  promoted: string[];
  failed: PromocaoRecusada[];
}

/**
 * Promoção de histórias PELO USUÁRIO (Fase 12c, RN-048) — o passo humano que
 * a Fase 10 não tinha (achado #13 do dogfooding).
 *
 * Não implementa transição nenhuma: delega ao `TransitionStoryUseCase`, que
 * desde a Fase 3b valida prontidão e módulos e, desde a 12b, escreve as linhas
 * de outbox `task.became_claimable` que acordam os dev agents idle do módulo.
 * Aquele use-case existia e não era chamado por rota nenhuma — era o código
 * morto que o achado #13 apontou. Promover por aqui o traz de volta à vida e
 * herda o reagendamento da 12b sem uma linha nova.
 *
 * **Individual é lote de 1.** Uma via só, e o comportamento de lote (falha
 * parcial, contagem no toast) fica exercitado também pelo caminho de uma
 * história — em vez de existir um segundo caminho que ninguém testa.
 *
 * **Falha parcial NÃO aborta.** Cada história é sua própria transação: uma
 * história que perdeu a prontidão (ou cujo módulo saiu do module_map entre a
 * proposta e a decisão) não pode impedir a promoção das outras que o usuário
 * acabou de revisar. As recusadas voltam em `failed` com o motivo, para a UI
 * dizer POR QUE — o oposto de um 500 que apaga o lote inteiro.
 */
@Injectable()
export class PromoteStoriesUseCase {
  constructor(
    private readonly stories: StoryRepository,
    private readonly transitionStory: TransitionStoryUseCase,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(
    projectId: string,
    storyIds: string[],
    userId: string,
  ): Promise<PromoteStoriesResult> {
    const promoted: string[] = [];
    const failed: PromocaoRecusada[] = [];

    for (const storyId of storyIds) {
      try {
        await this.promoverUma(projectId, storyId, userId);
        promoted.push(storyId);
      } catch (erro) {
        failed.push({ storyId, reason: motivo(erro) });
      }
    }

    return { promoted, failed };
  }

  /**
   * A transição e o desligamento da proposta na MESMA transação. Se
   * `proposed_ready` ficasse ligado depois da promoção, a história apareceria
   * para sempre na seção "aguardando sua promoção" já estando `ready` — uma
   * pendência que não existe mais. `runInTransaction` é reentrante (o
   * `TransitionStoryUseCase` abre a sua e reusa esta, via contexto assíncrono),
   * então isto é uma transação só, não duas aninhadas.
   *
   * `sessionId` sai da PRÓPRIA história, não da rota: a story sabe em que
   * sessão nasceu, e um lote pode misturar histórias de sessões diferentes —
   * cada evento tem de cair na linha do tempo onde o trabalho aconteceu.
   */
  private async promoverUma(
    projectId: string,
    storyId: string,
    userId: string,
  ): Promise<void> {
    const story = await this.stories.findById(storyId);
    if (!story || story.projectId !== projectId) {
      throw new Error('História não encontrada');
    }

    await this.unitOfWork.runInTransaction(async () => {
      await this.transitionStory.execute(
        projectId,
        story.sessionId,
        storyId,
        'ready',
        { kind: 'user', id: userId },
      );
      await this.stories.setProposedReady(storyId, false);
    });
  }
}

function motivo(erro: unknown): string {
  if (erro instanceof Error) return erro.message;
  return String(erro);
}
