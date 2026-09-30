import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { HandoffRepository } from '../../ports/handoff-repository.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { CicloDeVidaDoHandoff } from './ciclo-de-vida-do-handoff.service';
import type { Handoff } from '../../../domain/sessions/handoff.entity';
import {
  decidirOferta,
  mensagemDeAgenteJaAtivo,
  RECUSA_AGENTE_JA_ATIVO,
  type DesfechoDaOferta,
} from '../../../domain/sessions/ciclo-de-vida-do-handoff';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import type { Actor } from '../../../domain/sessions/session-event.entity';
import {
  assertHandoffTargetAllowed,
  HandoffToSubagentError,
} from '../../../domain/agents/agent-areas';

export interface CreateHandoffInput {
  fromAgent: string;
  toAgent: string;
  artifactId?: string | null;
  /**
   * Ator que grava o `handoff.offered` (ADR 0109/RN-440). Default
   * `{kind:'agent', id: fromAgent}` — o caminho de sempre, o PRÓPRIO agente
   * oferecendo o handoff que produziu. `RequestManualHandoffUseCase` passa
   * `{kind:'user', id: userId}` explicitamente: no handoff MANUAL quem
   * decidiu foi a pessoa, não `fromAgent` (que ali só documenta de que
   * conversa o handoff partiu, não quem pediu).
   */
  actor?: Actor;
  /**
   * "Só se ninguém recebeu ainda" (RN-636): com oferta pendente ao destino em
   * QUALQUER sessão do projeto, devolve a existente sem substituir. É o modo
   * do AppSec, que oferece um parecer por história aos mesmos três destinos.
   */
  seAusente?: boolean;
}

/** O handoff vigente ao destino, e como se chegou a ele (ADR 0182). */
export type OfertaDeHandoff = Handoff & { desfecho: DesfechoDaOferta };

/**
 * Cria um handoff OFFERED — chamado pelo engine (endpoint interno) quando o
 * Criativo emite o product_brief e oferece o handoff ao PO. A api é dona da
 * tabela `handoffs` (o engine nunca escreve tabela da api direto). Registra
 * também o session_event `handoff.offered` imutável.
 *
 * É o ÚNICO lugar do sistema que grava `toAgent`, e por isso é aqui que a
 * regra de alvo do ADR 0038 é aplicada: handoff externo endereça só lead de
 * área ou agente sem área. A `offer_handoff` do engine repassa `to_agent` como
 * string livre, então sem esta guarda um agente podia se dirigir direto a
 * `qa-automacao` e furar a hierarquia — a validação que o ADR mandou fazer e
 * que nunca tinha sido implementada (achado #12 do primeiro dogfooding).
 *
 * E é idempotente por (projeto, destino, `offered`) desde o ADR 0182
 * (RN-635): nunca há duas ofertas pendentes ao mesmo destino no projeto. A
 * regra de qual sobrevive está em `decidirOferta`; oferta a agente já ATIVO no
 * projeto é recusada com 409 `agente_ja_ativo`, cuja frase é o que o modelo lê.
 */
@Injectable()
export class CreateHandoffUseCase {
  constructor(
    private readonly handoffs: HandoffRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly unitOfWork: UnitOfWork,
    private readonly ciclo: CicloDeVidaDoHandoff,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    input: CreateHandoffInput,
  ): Promise<OfertaDeHandoff> {
    // Antes do INSERT: um handoff recusado não pode deixar linha nem evento.
    // `BadRequestException` porque quem chama é o engine, por rota interna —
    // 400 diz "o pedido está errado", que é o caso, e o erro tipado viaja no
    // corpo para o agente saber a quem se dirigir.
    try {
      assertHandoffTargetAllowed(input.toAgent);
    } catch (error) {
      if (error instanceof HandoffToSubagentError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    // RN-581: a recusa de sessão encerrada vem ANTES de criar a linha — o
    // evento é gravado depois dela, sem transação, e recusá-lo só ali deixaria
    // um handoff `offered` órfão numa sessão que ninguém mais abre.
    const actor: Actor = input.actor ?? { kind: 'agent', id: input.fromAgent };
    await this.appendEvent.garantirQueAceita(
      projectId,
      sessionId,
      'handoff.offered',
      actor,
    );

    const artifactId = input.artifactId ?? null;

    // Uma transação, com o par (projeto, destino) travado do começo ao fim:
    // duas abas ou um duplo clique chegam aqui ao mesmo tempo, e sem o lock os
    // dois leriam "nenhuma pendente" e criariam uma cada.
    return this.unitOfWork.runInTransaction(async () => {
      await this.handoffs.travarOfertasDoDestino(projectId, input.toAgent);

      const sessaoAtiva = await this.ciclo.sessaoOndeEstaAtivo(
        projectId,
        input.toAgent,
      );
      if (sessaoAtiva) {
        throw new ConflictException({
          message: mensagemDeAgenteJaAtivo(input.toAgent, sessaoAtiva),
          reason: RECUSA_AGENTE_JA_ATIVO,
          toAgent: input.toAgent,
          sessionId: sessaoAtiva,
        });
      }

      const pendentes = await this.handoffs.findOfferedToAgentInProject(
        projectId,
        input.toAgent,
      );
      const decisao = decidirOferta(pendentes, {
        sessionId,
        artifactId,
        seAusente: input.seAusente,
      });

      if (decisao.tipo === 'reusar') {
        await this.ciclo.substituir(
          projectId,
          decisao.substituir,
          'nova_oferta',
          decisao.vigente.id,
        );
        return { ...decisao.vigente, desfecho: 'ja_oferecido' as const };
      }

      const handoff = await this.handoffs.create({
        sessionId,
        projectId,
        fromAgent: input.fromAgent,
        toAgent: input.toAgent,
        artifactId,
        status: 'offered',
      });

      await this.ciclo.substituir(
        projectId,
        decisao.substituir,
        'nova_oferta',
        handoff.id,
      );

      await this.appendEvent.execute(projectId, sessionId, {
        type: 'handoff.offered',
        actor,
        payload: {
          handoffId: handoff.id,
          toAgent: input.toAgent,
          artifactId: handoff.artifactId,
        },
      });

      const desfecho: DesfechoDaOferta =
        decisao.substituir.length > 0 ? 'substituiu_oferta' : 'criado';
      return { ...handoff, desfecho };
    });
  }
}
