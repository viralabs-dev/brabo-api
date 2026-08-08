import { Injectable } from '@nestjs/common';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { AgentAreaRepository } from '../../ports/agent-area-repository.port';
import { ProposeActionUseCase } from '../actions/propose-action.use-case';
import { AcceptParallelizationUseCase } from './accept-parallelization.use-case';
import {
  decidirParalelismo,
  motivoDoPedido,
} from '../../../domain/execution/paralelismo';

/** Teto usado quando o projeto ainda não tem área de dev registrada. */
export const MAX_PARALLEL_PADRAO = 2;

/**
 * O pedido de paralelismo do LEAD (ADR 0053, FASE 14d).
 *
 * Substitui o "aceite de um clique" como PORTA DE ENTRADA. O que muda não é o
 * efeito — continua subindo um dev extra — é quem decide: dentro do teto o
 * lead sobe e segue; acima dele vira `proposed_action` e o usuário autoriza,
 * pelo mesmo pipeline de toda ação com efeito externo.
 *
 * `AcceptParallelizationUseCase` continua existindo e não muda: ele é o que
 * EXECUTA, seja no caminho direto, seja quando a `proposed_action` é aprovada.
 * Absorvê-lo por dentro em vez de reescrevê-lo é o que mantém a Fase 4 verde.
 */
@Injectable()
export class RequestParallelizationUseCase {
  constructor(
    private readonly events: SessionEventRepository,
    private readonly areas: AgentAreaRepository,
    private readonly proposeAction: ProposeActionUseCase,
    private readonly accept: AcceptParallelizationUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    module: string,
    userId: string,
  ) {
    const ativosNaSessao = await this.contarAtivos(projectId, sessionId);
    const area = await this.areas.findByKey(projectId, 'dev');
    const maxParallel = area?.maxParallel ?? MAX_PARALLEL_PADRAO;

    const entrada = { ativosNaSessao, pedidos: 1, maxParallel };
    const decisao = decidirParalelismo(entrada);

    if (!decisao.permitido) {
      return { estado: 'recusado' as const, motivo: decisao.motivo };
    }

    if (!decisao.requerAutorizacao) {
      await this.accept.execute(projectId, sessionId, module, userId);
      return { estado: 'executado' as const, ativosNaSessao, maxParallel };
    }

    // Acima do teto: quem decide é o usuário. O ator é o LEAD, não ele — o
    // pipeline distingue quem PEDE de quem DECIDE, e é isso que faz o event
    // log contar a história certa depois.
    const acao = await this.proposeAction.execute(projectId, sessionId, {
      actionType: 'parallelize',
      actor: { kind: 'agent', id: area?.leadAgentId ?? 'dev-lead' },
      payload: {
        module,
        ativosNaSessao,
        maxParallel,
        excedente: decisao.excedente,
        motivo: motivoDoPedido(entrada),
      },
    });

    return {
      estado: 'aguardando_autorizacao' as const,
      actionId: acao.id,
      ativosNaSessao,
      maxParallel,
    };
  }

  /**
   * Quantos dev agents a SESSÃO já tem, somando todos os módulos.
   *
   * Derivado do event log, que é a fonte de verdade imutável do produto — o
   * estado vivo dos agentes mora no engine, e pedi-lo por HTTP a cada decisão
   * acoplaria a autorização à disponibilidade dele.
   *
   * `execution.activated` traz os módulos da ativação (um agente cada), e cada
   * `execution.parallelization_accepted` soma um.
   */
  private async contarAtivos(
    projectId: string,
    sessionId: string,
  ): Promise<number> {
    const daSessao = (tipo: string) =>
      this.events
        .listByTypeForProject(projectId, tipo)
        .then((lista) => lista.filter((e) => e.sessionId === sessionId));

    const [ativacoes, aceites] = await Promise.all([
      daSessao('execution.activated'),
      daSessao('execution.parallelization_accepted'),
    ]);

    const base = ativacoes.reduce((total, e) => {
      const modules = (e.payload as { modules?: unknown }).modules;
      return total + (Array.isArray(modules) ? modules.length : 0);
    }, 0);

    return base + aceites.length;
  }
}
