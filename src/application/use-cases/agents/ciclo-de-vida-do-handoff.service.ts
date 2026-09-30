import { Injectable } from '@nestjs/common';
import { HandoffRepository } from '../../ports/handoff-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { isTerminal } from '../../../domain/sessions/session-state-machine';
import type { Handoff } from '../../../domain/sessions/handoff.entity';
import type { Actor } from '../../../domain/sessions/session-event.entity';
import type { MotivoDaSubstituicao } from '../../../domain/sessions/ciclo-de-vida-do-handoff';

/**
 * Quem grava a substituição. `system`, e não o usuário nem o agente: a oferta
 * não foi retirada por ninguém, deixou de valer por um fato (o destino ativou,
 * ou chegou outra). Ator `system` e tipo fora de `TIPOS_DA_CONVERSA` também
 * deixam o evento entrar numa sessão ENCERRADA (RN-581) — que é justamente
 * onde mora a oferta velha que ninguém mais vai aceitar.
 */
const ATOR_DO_CICLO: Actor = { kind: 'system', id: 'handoff-lifecycle' };

/**
 * As peças de IO do ciclo de vida da oferta (ADR 0182, RN-635), compartilhadas
 * pelos três lugares que o tocam: criar oferta, ativar agente e ativar
 * execução. A decisão pura mora em `domain/sessions/ciclo-de-vida-do-handoff.ts`.
 */
@Injectable()
export class CicloDeVidaDoHandoff {
  constructor(
    private readonly handoffs: HandoffRepository,
    private readonly events: SessionEventRepository,
    private readonly sessions: SessionRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  /**
   * A sessão em que o agente está ATIVO no projeto, ou `null`. Ativo = houve
   * `agent.activated` para ele numa sessão do projeto que NÃO é terminal — a
   * mesma leitura da tela (`session-handoffs.ts`), estendida da sessão ao
   * projeto; sessão encerrada para os conversacionais dela (RN-581), então ali
   * ele não está mais ativo.
   */
  async sessaoOndeEstaAtivo(
    projectId: string,
    agent: string,
  ): Promise<string | null> {
    const ativacoes = await this.events.listByTypeForProject(
      projectId,
      'agent.activated',
    );
    const sessoes = new Set(
      ativacoes
        .filter(
          (e) => (e.payload as { agent?: unknown } | null)?.agent === agent,
        )
        .map((e) => e.sessionId),
    );
    if (sessoes.size === 0) return null;
    for (const sessao of await this.sessions.listForProject(projectId)) {
      if (sessoes.has(sessao.id) && !isTerminal(sessao.status)) {
        return sessao.id;
      }
    }
    return null;
  }

  /**
   * Marca `superseded` e grava um `handoff.superseded` na sessão DE CADA
   * oferta (é lá que ela foi anunciada). Chame sob `travarOfertasDoDestino`.
   */
  async substituir(
    projectId: string,
    ofertas: readonly Handoff[],
    motivo: MotivoDaSubstituicao,
    substitutaId: string | null,
  ): Promise<void> {
    for (const oferta of ofertas) {
      await this.handoffs.updateStatus(oferta.id, 'superseded');
      await this.appendEvent.execute(projectId, oferta.sessionId, {
        type: 'handoff.superseded',
        actor: ATOR_DO_CICLO,
        payload: {
          handoffId: oferta.id,
          toAgent: oferta.toAgent,
          motivo,
          substitutaId,
        },
      });
    }
  }

  /**
   * O agente acabou de ser ativado: toda oferta ainda `offered` a ele, em
   * QUALQUER sessão do projeto, deixa de ser acionável. A aceita não é tocada
   * (já é `accepted`).
   */
  async substituirOfertasAoAtivar(
    projectId: string,
    agent: string,
  ): Promise<void> {
    await this.unitOfWork.runInTransaction(async () => {
      await this.handoffs.travarOfertasDoDestino(projectId, agent);
      const pendentes = await this.handoffs.findOfferedToAgentInProject(
        projectId,
        agent,
      );
      await this.substituir(projectId, pendentes, 'agente_ativado', null);
    });
  }
}
