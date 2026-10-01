import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { PsychologistHypothesisRepository } from '../../ports/psychologist-hypothesis-repository.port';
import { AnamneseQueueRepository } from '../../ports/anamnese-repository.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import {
  assertHypothesisTransition,
  InvalidHypothesisTransitionError,
} from '../../../domain/psychologist/hypothesis-lifecycle';

/**
 * O usuário aceita uma hipótese do Psicólogo (Fase 4b) — proposed ->
 * accepted. Emite `psychologist.hypothesis_accepted` (auditoria) e um
 * SEGUNDO evento, `psychologist.hypothesis_accepted_for_anamnese` (tipo
 * distinto, não uma flag no payload — trivialmente filtrável por um
 * consumidor que só se interessa pelo loop fechado).
 *
 * Tudo numa transação: a transição, os dois eventos e o enfileiramento pra
 * Anamnese. Em quatro transações separadas, um crash no meio deixava uma
 * hipótese `accepted` que nunca chegou na fila — quebrando exatamente o
 * loop fechado que o accept existe pra alimentar.
 *
 * ## O destino da hipótese aceita (RN-680, ADR 0196)
 *
 * Desde a RN-680 o `psychologist.hypothesis_accepted` carrega o que o fato do
 * perfil precisa — `sujeito`, `projectId`, `hipotese`, `sugestao` — e
 * `fatoDoPerfil`, que diz se ESTE aceite vira fato do perfil da pessoa no
 * grafo (o `GraphEventTranslator` o traduz; `grafo:reprojetar` o reconstrói).
 * O sujeito é o AUTOR da sessão analisada — é dele a interação que o
 * Psicólogo leu —, e o fato só nasce quando quem aceitou é ele mesmo: um fato
 * sobre a pessoa nunca nasce do clique de outra. Aceite de terceiro continua
 * valendo para tudo o mais (status, fila da Anamnese) e o payload diz por quê
 * não virou fato (`motivoSemFato`). A recusada (`DismissHypothesisUseCase`)
 * segue só registrada.
 */
@Injectable()
export class AcceptHypothesisUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly hypotheses: PsychologistHypothesisRepository,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly anamneseQueue: AnamneseQueueRepository,
    private readonly sessions: SessionRepository,
  ) {}

  async execute(projectId: string, hypothesisId: string, userId: string) {
    const hypothesis = await this.hypotheses.findById(hypothesisId);
    if (!hypothesis || hypothesis.projectId !== projectId) {
      throw new NotFoundException('Hipótese não encontrada');
    }

    // Checagem antecipada só pra dar a mensagem de domínio boa; quem
    // garante a exclusão mútua é o CAS abaixo.
    try {
      assertHypothesisTransition(hypothesis.status, 'accepted');
    } catch (error) {
      if (error instanceof InvalidHypothesisTransitionError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    // Lido FORA da transação: o autor da sessão não muda, e a leitura não
    // precisa segurar a transação do aceite.
    const sessao = await this.sessions.findInProject(
      projectId,
      hypothesis.sessionId,
    );
    const sujeito = sessao?.createdBy ?? null;
    const fatoDoPerfil = sujeito !== null && sujeito === userId;

    return this.unitOfWork.runInTransaction(async () => {
      const updated = await this.hypotheses.updateStatusIfProposed(
        hypothesisId,
        'accepted',
        userId,
        new Date(),
      );

      if (!updated) {
        throw new BadRequestException(
          'hipótese já foi decidida (aceita ou descartada) por outra ação',
        );
      }

      const payload = {
        hypothesisId: updated.id,
        agenteAlvo: updated.agenteAlvo,
      };

      await this.appendSessionEvent.execute(projectId, updated.sessionId, {
        type: 'psychologist.hypothesis_accepted',
        actor: { kind: 'user', id: userId },
        payload: {
          ...payload,
          projectId,
          sujeito,
          hipotese: updated.hipotese,
          sugestao: updated.sugestao,
          fatoDoPerfil,
          ...(fatoDoPerfil
            ? {}
            : {
                motivoSemFato:
                  sujeito === null
                    ? 'sessao_sem_autor'
                    : 'aceita_por_quem_nao_e_o_sujeito',
              }),
        },
      });

      await this.appendSessionEvent.execute(projectId, updated.sessionId, {
        type: 'psychologist.hypothesis_accepted_for_anamnese',
        actor: { kind: 'user', id: userId },
        payload,
      });

      // Loop fechado (Fase 4b): a hipótese aceita vira input PRIORIZADO da
      // próxima rodada da Anamnese. Enfileirar aqui é determinístico —
      // não depende de rotear o outbox nem de o consumidor estar de pé.
      // Idempotente por hypothesisId (unique + doNothing).
      await this.anamneseQueue.enqueueHypothesis(projectId, updated.id);

      return updated;
    });
  }
}
